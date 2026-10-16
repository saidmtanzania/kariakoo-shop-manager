import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  addInterval,
  entitlementsFor,
  nextPeriodStart,
  paidUntilFromPeriods,
  subscriptionStatus,
  type Entitlements,
  type PaymentMethod,
  type PaymentView,
  type SubscriptionSummary,
  type SubscriptionView,
} from '@ksm/shared';
import type { ShopContext } from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/env.schema.js';
import {
  Prisma,
  PrismaService,
  scopedToShop,
  type ShopScopedTx,
  type Subscription,
} from '../../../database/index.js';

const MAX_HISTORY = 50;

type PaymentWithDetails = Prisma.SubscriptionPaymentGetPayload<{
  include: { plan: { select: { name: true } }; period: true };
}>;

export function toPaymentView(p: PaymentWithDetails): PaymentView {
  return {
    id: p.id,
    planName: p.plan.name,
    amount: p.amount.toFixed(2),
    currency: p.currency,
    provider: p.provider,
    reference: p.providerReference,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
    note: p.note,
    period: p.period
      ? {
          start: p.period.periodStart.toISOString(),
          end: p.period.periodEnd.toISOString(),
          reversed: p.period.reversedAt !== null,
        }
      : null,
  };
}

/**
 * A shop's subscription: its status (derived from dates, never stored),
 * what it entitles the shop to, and the paid periods that move its
 * paid-until date. Confirming and reversing periods happens only here, in
 * the caller's transaction, after the caller has verified the payment.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Starts the free trial; called in the shop-creation transaction. */
  async createForShop(
    tx: Prisma.TransactionClient,
    shopId: string,
    now = new Date(),
  ): Promise<Subscription> {
    const settings = await this.settings(tx);
    return tx.subscription.create({
      data: {
        id: newId(),
        shopId,
        trialEndsAt: new Date(now.getTime() + settings.trialDays * 86_400_000),
      },
    });
  }

  async settings(db: Prisma.TransactionClient | PrismaService = this.prisma) {
    // The migration inserts the single row; this only guards a hand-edited database.
    return (
      (await db.billingSettings.findUnique({ where: { id: 1 } })) ?? {
        id: 1,
        trialDays: 14,
        reminderDaysBefore: 3,
        paymentInstructions: null,
        updatedAt: new Date(0),
      }
    );
  }

  /** Payment methods shops can use now (manual always; sandbox outside production when configured). */
  methods(): PaymentMethod[] {
    return this.config.PAYMENT_SANDBOX_SECRET
      ? ['manual', 'sandbox']
      : ['manual'];
  }

  /**
   * What the shop's subscription allows now. A shop without a subscription
   * row (which the migration and shop creation prevent) is treated as
   * restricted, so the check fails closed.
   */
  async entitlements(shopId: string, now = new Date()): Promise<Entitlements> {
    const sub = await scopedToShop(this.prisma, shopId).subscription.findFirst({
      include: { plan: { include: { features: true } } },
    });
    if (!sub) return entitlementsFor('RESTRICTED', null);
    const { status } = subscriptionStatus(sub, now);
    return entitlementsFor(status, sub.plan?.features ?? null);
  }

  async summary(
    shopId: string,
    now = new Date(),
  ): Promise<SubscriptionSummary | null> {
    const [sub, settings] = await Promise.all([
      scopedToShop(this.prisma, shopId).subscription.findFirst(),
      this.settings(),
    ]);
    if (!sub) return null;
    const s = subscriptionStatus(sub, now);
    const msLeft = s.accessEndsAt.getTime() - now.getTime();
    return {
      status: s.status,
      readOnly: s.status === 'RESTRICTED',
      accessEndsAt: s.accessEndsAt.toISOString(),
      endingSoon:
        msLeft > 0 && msLeft <= settings.reminderDaysBefore * 86_400_000,
    };
  }

  /**
   * Staff seats the shop may use: members who are not removed plus unexpired
   * pending invitations. Null means unlimited.
   */
  async seatLimit(shopId: string): Promise<number | null> {
    return (await this.entitlements(shopId)).features.seats.limit;
  }

  async view(ctx: ShopContext, now = new Date()): Promise<SubscriptionView> {
    const db = scopedToShop(this.prisma, ctx.shopId);
    const sub = await db.subscription.findFirst({
      include: { plan: { include: { features: true } } },
    });
    if (!sub) {
      throw new NotFoundException({
        message: 'This shop has no subscription.',
        code: 'subscription_not_found',
      });
    }
    const [payments, settings] = await Promise.all([
      db.subscriptionPayment.findMany({
        include: { plan: { select: { name: true } }, period: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_HISTORY,
      }),
      this.settings(),
    ]);
    const s = subscriptionStatus(sub, now);
    const ent = entitlementsFor(s.status, sub.plan?.features ?? null);
    return {
      status: s.status,
      readOnly: ent.readOnly,
      trialEndsAt: sub.trialEndsAt.toISOString(),
      paidUntil: sub.paidUntil?.toISOString() ?? null,
      accessEndsAt: s.accessEndsAt.toISOString(),
      graceEndsAt: s.graceEndsAt?.toISOString() ?? null,
      plan: sub.plan
        ? { id: sub.plan.id, name: sub.plan.name, interval: sub.plan.interval }
        : null,
      features: ent.features,
      paymentInstructions: settings.paymentInstructions,
      methods: this.methods(),
      payments: payments.map(toPaymentView),
    };
  }

  /**
   * Adds the paid time for a payment the caller has just confirmed, in the
   * caller's transaction. The subscription row is locked so concurrent
   * confirmations extend it one after the other. A period starts after the
   * trial or time already paid for, or now if both are over.
   */
  async grantPeriod(
    db: ShopScopedTx,
    payment: { id: string; subscriptionId: string; planId: string },
    now: Date,
  ): Promise<{ periodStart: Date; periodEnd: Date; planName: string }> {
    const sub = await this.lock(db, payment.subscriptionId);
    const plan = await this.prisma.plan.findUniqueOrThrow({
      where: { id: payment.planId },
    });
    const periodStart = nextPeriodStart(sub, now);
    const periodEnd = addInterval(periodStart, plan.interval);
    await db.subscriptionPeriod.create({
      data: {
        id: newId(),
        shopId: sub.shopId,
        subscriptionId: sub.id,
        planId: plan.id,
        paymentId: payment.id,
        interval: plan.interval,
        periodStart,
        periodEnd,
        createdAt: now,
      },
    });
    await db.subscription.update({
      where: { id: sub.id },
      data: {
        paidUntil: periodEnd,
        planId: plan.id,
        graceDays: plan.graceDays,
      },
    });
    return { periodStart, periodEnd, planName: plan.name };
  }

  /**
   * Removes the paid time of a reversed payment: marks its period reversed
   * (the row is kept) and recomputes paid-until from the periods that
   * remain, in the order they were confirmed.
   */
  async reversePeriod(
    db: ShopScopedTx,
    payment: { id: string; subscriptionId: string },
    now: Date,
  ): Promise<{ paidUntil: Date | null }> {
    const sub = await this.lock(db, payment.subscriptionId);
    await db.subscriptionPeriod.updateMany({
      where: { paymentId: payment.id, reversedAt: null },
      data: { reversedAt: now },
    });
    const remaining = await db.subscriptionPeriod.findMany({
      where: { subscriptionId: sub.id, reversedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const paidUntil = paidUntilFromPeriods(
      sub.trialEndsAt,
      remaining.map((p) => ({
        confirmedAt: p.createdAt,
        interval: p.interval,
      })),
    );
    const last = remaining.at(-1);
    await db.subscription.update({
      where: { id: sub.id },
      data: { paidUntil, planId: last?.planId ?? null },
    });
    return { paidUntil };
  }

  /** Active owners' email addresses, for subscription notices. */
  async ownerEmails(db: ShopScopedTx): Promise<string[]> {
    const owners = await db.shopMembership.findMany({
      where: { isOwner: true, status: 'ACTIVE' },
      include: { user: { select: { email: true } } },
    });
    return owners.map((o) => o.user.email);
  }

  private async lock(db: ShopScopedTx, subscriptionId: string) {
    await db.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subscriptionId}::uuid FOR UPDATE`;
    return db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  }
}
