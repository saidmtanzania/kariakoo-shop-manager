import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  PaymentMethod,
  PaymentView,
  PlatformPaymentView,
} from '@ksm/shared';
import type {
  AuthContext,
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  PaymentStatus,
  Prisma,
  PrismaService,
  scopedToShop,
  type ShopScopedTx,
  type SubscriptionPayment,
} from '../../../database/index.js';
import { MailService } from '../../../mail/mail.service.js';
import {
  paymentConfirmedMessage,
  paymentProblemMessage,
} from '../../../mail/templates.js';
import { OutboxService } from '../../../outbox/outbox.service.js';
import {
  AuditService,
  type AuditAction,
} from '../../audit/services/audit.service.js';
import {
  SubscriptionsService,
  toPaymentView,
} from '../../subscriptions/services/subscriptions.service.js';
import type { ProviderUpdate } from '../providers/payment-provider.js';
import { ProviderRegistry } from '../providers/provider-registry.js';

/** A shop may have this many payments waiting at once. */
export const MAX_PENDING_PAYMENTS = 3;

/** Result of applying a provider status to a payment (stored on the event). */
export type UpdateOutcome =
  | 'confirmed'
  | 'failed'
  | 'reversed'
  | 'duplicate'
  | 'amount_mismatch'
  | 'flagged'
  | 'ignored'
  | 'pending'
  | 'unknown_payment';

/** Who decided: a platform operator, or a verified provider message. */
interface Actor {
  userId: string | null;
  client?: ClientInfo;
  source: 'platform' | 'callback' | 'reconciliation';
}

const include = {
  plan: { select: { name: true } },
  period: true,
} as const;

const notFound = () =>
  new NotFoundException({
    message: 'Payment not found.',
    code: 'payment_not_found',
  });

function normalizeReference(reference: string): string {
  return reference.trim().toUpperCase();
}

/**
 * Subscription payments (decision D-006). A payment gives the shop paid time
 * only when platform staff confirm it (manual) or a provider's verified
 * callback or status lookup confirms it; never because a browser says so.
 * Provider requests happen outside database transactions; every state
 * change locks the payment row, so duplicate and concurrent notices settle
 * to one result.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly providers: ProviderRegistry,
    private readonly outbox: OutboxService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // ---- Shop side ----

  /**
   * Records a payment the shop says it made (manual) or starts one with a
   * provider. Either way it is PENDING: nothing changes for the shop until
   * the payment is confirmed. Retrying with the same idempotency key returns
   * the same payment.
   */
  async submit(
    ctx: ShopContext,
    input: {
      planId: string;
      method?: PaymentMethod;
      reference?: string;
      payerPhone?: string;
      idempotencyKey: string;
    },
    client: ClientInfo,
  ): Promise<PaymentView> {
    const method = input.method ?? 'manual';
    const provider = this.providers.get(method);
    if (!provider) {
      throw new BadRequestException({
        message: 'This payment method is not available.',
        code: 'payment_method_unavailable',
      });
    }
    const manual = method === 'manual';
    if (manual && !input.reference) {
      throw new BadRequestException({
        message: 'Enter the transaction reference from your payment message.',
        code: 'reference_required',
      });
    }
    const db = scopedToShop(this.prisma, ctx.shopId);

    const existing = await db.subscriptionPayment.findFirst({
      where: { idempotencyKey: input.idempotencyKey },
      include,
    });
    if (existing) return this.replay(existing, input, manual);

    const plan = await this.prisma.plan.findUnique({
      where: { id: input.planId },
    });
    if (!plan?.active) {
      throw new NotFoundException({
        message: 'This plan is not available.',
        code: 'plan_not_found',
      });
    }

    const paymentId = newId();
    const reference = manual
      ? normalizeReference(input.reference!)
      : `PENDING-${paymentId}`;
    try {
      await db.$transaction(async (tx) => {
        const sub = await tx.subscription.findFirstOrThrow();
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${sub.id}::uuid FOR UPDATE`;
        const pending = await tx.subscriptionPayment.count({
          where: { status: PaymentStatus.PENDING },
        });
        if (pending >= MAX_PENDING_PAYMENTS) {
          throw new ConflictException({
            message:
              'You already have payments waiting for confirmation. Wait for them to be checked first.',
            code: 'too_many_pending_payments',
          });
        }
        await tx.subscriptionPayment.create({
          data: {
            id: paymentId,
            shopId: ctx.shopId,
            subscriptionId: sub.id,
            planId: plan.id,
            amount: plan.price,
            currency: plan.currency,
            provider: provider.key,
            providerReference: reference,
            payerPhone: input.payerPhone?.trim() || null,
            idempotencyKey: input.idempotencyKey,
            initiatedByUserId: ctx.userId,
          },
        });
        await this.audit.record(
          {
            action: 'subscription.payment_submitted',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'subscription_payment',
            entityId: paymentId,
            after: {
              plan: plan.code,
              amount: plan.price.toFixed(2),
              provider: provider.key,
              reference,
            },
            client,
          },
          tx,
        );
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Either a concurrent retry with the same key, or a reused reference.
        const raced = await db.subscriptionPayment.findFirst({
          where: { idempotencyKey: input.idempotencyKey },
          include,
        });
        if (raced) return this.replay(raced, input, manual);
        throw new ConflictException({
          message: 'This transaction reference has already been submitted.',
          code: 'payment_reference_used',
        });
      }
      throw err;
    }

    if (provider.initiate) {
      // Outside the transaction: a slow or failing provider never holds locks.
      try {
        const started = await provider.initiate({
          paymentId,
          amount: plan.price.toFixed(2),
          currency: plan.currency,
          payerPhone: input.payerPhone ?? null,
        });
        await db.subscriptionPayment.update({
          where: { id: paymentId },
          data: { providerReference: started.reference },
        });
      } catch (err) {
        this.logger.warn(
          { err, paymentId },
          'Provider could not start payment',
        );
        await db.subscriptionPayment.updateMany({
          where: { id: paymentId, status: PaymentStatus.PENDING },
          data: {
            status: PaymentStatus.FAILED,
            failedAt: new Date(),
            note: 'The payment provider could not start this payment.',
          },
        });
      }
    }
    return toPaymentView(
      await db.subscriptionPayment.findUniqueOrThrow({
        where: { id: paymentId },
        include,
      }),
    );
  }

  private replay(
    existing: Parameters<typeof toPaymentView>[0],
    input: { planId: string; reference?: string },
    manual: boolean,
  ): PaymentView {
    const same =
      existing.planId === input.planId &&
      (!manual ||
        existing.providerReference ===
          normalizeReference(input.reference ?? ''));
    if (!same) {
      throw new ConflictException({
        message: 'This request key was already used for a different payment.',
        code: 'idempotency_conflict',
      });
    }
    return toPaymentView(existing);
  }

  // ---- Platform side ----

  async listForPlatform(
    filter: 'attention' | 'all',
  ): Promise<PlatformPaymentView[]> {
    const rows = await this.prisma.subscriptionPayment.findMany({
      where:
        filter === 'attention'
          ? { OR: [{ status: PaymentStatus.PENDING }, { needsReview: true }] }
          : {},
      include: { ...include, shop: { select: { name: true } } },
      orderBy: { createdAt: filter === 'attention' ? 'asc' : 'desc' },
      take: 200,
    });
    return rows.map((p) => ({
      ...toPaymentView(p),
      shopId: p.shopId,
      shopName: p.shop.name,
      payerPhone: p.payerPhone,
      needsReview: p.needsReview,
    }));
  }

  /**
   * Platform staff confirm a payment after checking the money arrived. A
   * payment marked failed can still be confirmed (money that arrived late).
   */
  async confirmByPlatform(
    auth: AuthContext,
    paymentId: string,
    note: string | undefined,
    client: ClientInfo,
  ): Promise<PlatformPaymentView> {
    await this.decide(paymentId, async (db, p, now) => {
      if (
        p.status === PaymentStatus.CONFIRMED ||
        p.status === PaymentStatus.REVERSED
      ) {
        throw new ConflictException({
          message: 'This payment has already been confirmed.',
          code: 'payment_already_decided',
        });
      }
      await this.confirm(
        db,
        p,
        now,
        { userId: auth.userId, client, source: 'platform' },
        note,
      );
    });
    return this.platformView(paymentId);
  }

  async rejectByPlatform(
    auth: AuthContext,
    paymentId: string,
    note: string | undefined,
    client: ClientInfo,
  ): Promise<PlatformPaymentView> {
    await this.decide(paymentId, async (db, p, now) => {
      if (p.status !== PaymentStatus.PENDING) {
        throw new ConflictException({
          message: 'Only a payment waiting for confirmation can be rejected.',
          code: 'payment_not_pending',
        });
      }
      await this.fail(
        db,
        p,
        now,
        { userId: auth.userId, client, source: 'platform' },
        note ?? null,
      );
    });
    return this.platformView(paymentId);
  }

  async reverseByPlatform(
    auth: AuthContext,
    paymentId: string,
    note: string | undefined,
    client: ClientInfo,
  ): Promise<PlatformPaymentView> {
    await this.decide(paymentId, async (db, p, now) => {
      if (p.status !== PaymentStatus.CONFIRMED) {
        throw new ConflictException({
          message: 'Only a confirmed payment can be reversed.',
          code: 'payment_not_confirmed',
        });
      }
      await this.reverse(
        db,
        p,
        now,
        { userId: auth.userId, client, source: 'platform' },
        note ?? null,
      );
    });
    return this.platformView(paymentId);
  }

  private async decide(
    paymentId: string,
    action: (
      db: ShopScopedTx,
      p: SubscriptionPayment,
      now: Date,
    ) => Promise<void>,
  ): Promise<void> {
    // Platform staff act across shops: find the shop, then work scoped to it.
    const found = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
      select: { shopId: true },
    });
    if (!found) throw notFound();
    await scopedToShop(this.prisma, found.shopId).$transaction(async (db) => {
      const p = await this.lockPayment(db, paymentId);
      await action(db, p, new Date());
    });
  }

  private async platformView(paymentId: string): Promise<PlatformPaymentView> {
    const p = await this.prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { ...include, shop: { select: { name: true } } },
    });
    return {
      ...toPaymentView(p),
      shopId: p.shopId,
      shopName: p.shop.name,
      payerPhone: p.payerPhone,
      needsReview: p.needsReview,
    };
  }

  // ---- Provider side ----

  /**
   * Applies a verified provider status to the payment it names. Safe to
   * call any number of times with the same or conflicting news: the row
   * lock and state checks make repeats no-ops, and anything that does not
   * fit (an amount that differs, success after failure, a reversal of an
   * unconfirmed payment) is flagged for platform review, never guessed.
   */
  async applyProviderUpdate(
    providerKey: string,
    update: ProviderUpdate,
    source: 'callback' | 'reconciliation',
  ): Promise<{ outcome: UpdateOutcome; paymentId: string | null }> {
    const found = await this.prisma.subscriptionPayment.findUnique({
      where: {
        provider_providerReference: {
          provider: providerKey,
          providerReference: update.reference,
        },
      },
      select: { id: true, shopId: true },
    });
    if (!found) return { outcome: 'unknown_payment', paymentId: null };
    const actor: Actor = { userId: null, source };

    const outcome = await scopedToShop(this.prisma, found.shopId).$transaction(
      async (db): Promise<UpdateOutcome> => {
        const p = await this.lockPayment(db, found.id);
        const now = new Date();
        switch (update.status) {
          case 'PENDING':
            return 'pending';
          case 'CONFIRMED':
            if (p.status === PaymentStatus.CONFIRMED) return 'duplicate';
            if (p.status === PaymentStatus.REVERSED) return 'ignored';
            if (p.status === PaymentStatus.FAILED) {
              await this.flag(
                db,
                p,
                'The provider confirmed this payment after it was marked failed.',
                actor,
              );
              return 'flagged';
            }
            if (!this.amountMatches(p, update)) {
              await this.flag(
                db,
                p,
                `The provider reported ${update.amount ?? 'no amount'} ${update.currency ?? ''}`.trim() +
                  `, but ${p.amount.toFixed(2)} ${p.currency} was expected.`,
                actor,
              );
              return 'amount_mismatch';
            }
            await this.confirm(db, p, now, actor);
            return 'confirmed';
          case 'FAILED':
            if (p.status === PaymentStatus.FAILED) return 'duplicate';
            if (p.status === PaymentStatus.REVERSED) return 'ignored';
            if (p.status === PaymentStatus.CONFIRMED) {
              await this.flag(
                db,
                p,
                'The provider reported a failure after the payment was confirmed.',
                actor,
              );
              return 'flagged';
            }
            await this.fail(
              db,
              p,
              now,
              actor,
              'The payment provider reported that the payment failed.',
            );
            return 'failed';
          case 'REVERSED':
            if (p.status === PaymentStatus.REVERSED) return 'duplicate';
            if (p.status === PaymentStatus.FAILED) return 'ignored';
            if (p.status === PaymentStatus.PENDING) {
              await this.flag(
                db,
                p,
                'The provider reported a reversal of a payment that was never confirmed.',
                actor,
              );
              return 'flagged';
            }
            await this.reverse(
              db,
              p,
              now,
              actor,
              'The payment provider reversed this payment.',
            );
            return 'reversed';
        }
      },
    );
    return { outcome, paymentId: found.id };
  }

  private amountMatches(
    p: SubscriptionPayment,
    update: ProviderUpdate,
  ): boolean {
    if (update.amount === null || !/^\d{1,16}(\.\d{1,2})?$/.test(update.amount))
      return false;
    if (
      update.currency !== null &&
      update.currency.toUpperCase() !== p.currency
    )
      return false;
    return new Prisma.Decimal(update.amount).equals(p.amount);
  }

  // ---- Transitions (always inside a transaction holding the payment lock) ----

  private async confirm(
    db: ShopScopedTx,
    p: SubscriptionPayment,
    now: Date,
    actor: Actor,
    note?: string,
  ): Promise<void> {
    const period = await this.subscriptions.grantPeriod(db, p, now);
    await db.subscriptionPayment.update({
      where: { id: p.id },
      data: {
        status: PaymentStatus.CONFIRMED,
        confirmedAt: now,
        decidedByUserId: actor.userId,
        needsReview: false,
        note: note?.trim() || null,
      },
    });
    await this.record(db, p, 'subscription.payment_confirmed', actor, {
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
    });
    await this.notifyOwners(db, p.shopId, (to, shopName, url) =>
      paymentConfirmedMessage(
        to,
        shopName,
        period.planName,
        period.periodEnd,
        url,
      ),
    );
  }

  private async fail(
    db: ShopScopedTx,
    p: SubscriptionPayment,
    now: Date,
    actor: Actor,
    note: string | null,
  ): Promise<void> {
    await db.subscriptionPayment.update({
      where: { id: p.id },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: now,
        decidedByUserId: actor.userId,
        needsReview: false,
        note: note?.trim() || null,
      },
    });
    await this.record(db, p, 'subscription.payment_failed', actor, { note });
    await this.notifyOwners(db, p.shopId, (to, shopName, url) =>
      paymentProblemMessage(to, shopName, 'failed', note, url),
    );
  }

  private async reverse(
    db: ShopScopedTx,
    p: SubscriptionPayment,
    now: Date,
    actor: Actor,
    note: string | null,
  ): Promise<void> {
    const { paidUntil } = await this.subscriptions.reversePeriod(db, p, now);
    await db.subscriptionPayment.update({
      where: { id: p.id },
      data: {
        status: PaymentStatus.REVERSED,
        reversedAt: now,
        decidedByUserId: actor.userId,
        needsReview: false,
        note: note?.trim() || null,
      },
    });
    await this.record(db, p, 'subscription.payment_reversed', actor, {
      note,
      paidUntil: paidUntil?.toISOString() ?? null,
    });
    await this.notifyOwners(db, p.shopId, (to, shopName, url) =>
      paymentProblemMessage(to, shopName, 'reversed', note, url),
    );
  }

  private async flag(
    db: ShopScopedTx,
    p: SubscriptionPayment,
    note: string,
    actor: Actor,
  ): Promise<void> {
    await db.subscriptionPayment.update({
      where: { id: p.id },
      data: { needsReview: true, note: note.slice(0, 500) },
    });
    await this.record(db, p, 'subscription.payment_flagged', actor, { note });
  }

  private async record(
    db: ShopScopedTx,
    p: SubscriptionPayment,
    action: AuditAction,
    actor: Actor,
    after: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        shopId: p.shopId,
        actorUserId: actor.userId,
        entityType: 'subscription_payment',
        entityId: p.id,
        before: { status: p.status },
        after: { ...after, source: actor.source },
        client: actor.client,
      },
      db,
    );
  }

  private async notifyOwners(
    db: ShopScopedTx,
    shopId: string,
    build: (
      to: string,
      shopName: string,
      url: string,
    ) => Parameters<OutboxService['enqueueEmail']>[0],
  ): Promise<void> {
    const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
    const url = this.mail.link('/subscription');
    for (const email of await this.subscriptions.ownerEmails(db)) {
      await this.outbox.enqueueEmail(build(email, shop.name, url), {
        db,
        shopId,
      });
    }
  }

  private async lockPayment(
    db: ShopScopedTx,
    paymentId: string,
  ): Promise<SubscriptionPayment> {
    await db.$queryRaw`SELECT id FROM subscription_payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    const p = await db.subscriptionPayment.findUnique({
      where: { id: paymentId },
    });
    if (!p) throw notFound();
    return p;
  }
}
