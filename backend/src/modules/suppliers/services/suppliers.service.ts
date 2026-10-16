import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  SupplierEntryView,
  SupplierPaymentMethod,
  SupplierPaymentView,
  SupplierReconciliation,
  SupplierView,
} from '@ksm/shared';
import { createHash } from 'node:crypto';
import type {
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  Prisma,
  PrismaService,
  scopedToShop,
  SupplierEntryType,
  type ShopScopedTx,
  type Supplier,
  type SupplierLedgerEntry,
  type SupplierPayment,
} from '../../../database/index.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { AuthorizationService } from '../../authorization/services/authorization.service.js';
import { SupplierLedgerService } from './supplier-ledger.service.js';

export interface SupplierCreate {
  name: string;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  openingBalance?: string | null;
}

export interface SupplierUpdate {
  name?: string;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  archived?: boolean;
}

export interface PaymentRequest {
  amount: string;
  method: SupplierPaymentMethod;
  reference?: string | null;
  note?: string | null;
}

const supplierNotFound = () =>
  new NotFoundException({
    message: 'Supplier not found.',
    code: 'supplier_not_found',
  });

const paymentNotFound = () =>
  new NotFoundException({
    message: 'Payment not found.',
    code: 'supplier_payment_not_found',
  });

const blank = (v: string | null | undefined) =>
  v === undefined ? undefined : v?.trim() ? v.trim() : null;

const shillings = (v: Prisma.Decimal) => v.toFixed(0);

function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

interface Cursor {
  n: string;
  i: string;
}

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Cursor;
    if (typeof c.n === 'string' && typeof c.i === 'string') return c;
  } catch {
    // fall through
  }
  throw new BadRequestException({
    message: 'Invalid page cursor.',
    code: 'invalid_cursor',
  });
}

/**
 * Suppliers, their account (ledger) and payments to them (Phase 06).
 * Balances change only through SupplierLedgerService.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: SupplierLedgerService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(
    ctx: ShopContext,
    query: { q?: string; archived?: boolean; cursor?: string; limit?: number },
  ): Promise<{ suppliers: SupplierView[]; nextCursor: string | null }> {
    const limit = query.limit ?? 50;
    const q = query.q?.trim();
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await scopedToShop(this.prisma, ctx.shopId).supplier.findMany({
      where: {
        archivedAt: query.archived ? { not: null } : null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
              ],
            }
          : {}),
        ...(after
          ? {
              AND: [
                {
                  OR: [
                    { name: { gt: after.n } },
                    { name: after.n, id: { gt: after.i } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      suppliers: page.map((s) => this.view(s, this.money(ctx))),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify({ n: last.name, i: last.id })).toString(
              'base64url',
            )
          : null,
    };
  }

  async get(ctx: ShopContext, supplierId: string): Promise<SupplierView> {
    const supplier = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw supplierNotFound();
    return this.view(supplier, this.money(ctx));
  }

  async create(
    ctx: ShopContext,
    input: SupplierCreate,
    client: ClientInfo,
  ): Promise<SupplierView> {
    const id = newId();
    const opening =
      input.openingBalance && /[1-9]/.test(input.openingBalance)
        ? input.openingBalance
        : null;
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        await db.supplier.create({
          data: {
            id,
            shopId: ctx.shopId,
            name: input.name.trim(),
            phone: blank(input.phone) ?? null,
            address: blank(input.address) ?? null,
            note: blank(input.note) ?? null,
            createdByMembershipId: ctx.membershipId,
          },
        });
        if (opening) {
          await this.ledger.post(db, ctx, {
            supplierId: id,
            type: SupplierEntryType.OPENING_BALANCE,
            amount: opening,
            note: 'Opening balance',
          });
        }
        await this.audit.record(
          {
            action: 'supplier.created',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'supplier',
            entityId: id,
            after: { name: input.name.trim(), openingBalance: opening },
            client,
          },
          db,
        );
      });
    } catch (err) {
      throw this.nameTaken(err);
    }
    return this.get(ctx, id);
  }

  async update(
    ctx: ShopContext,
    supplierId: string,
    input: SupplierUpdate,
    client: ClientInfo,
  ): Promise<SupplierView> {
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        const balance = await this.ledger.lockInShop(
          db,
          ctx.shopId,
          supplierId,
        );
        const before = await db.supplier.findUniqueOrThrow({
          where: { id: supplierId },
        });
        if (input.archived === true && !balance.isZero()) {
          throw new ConflictException({
            message:
              'Settle the balance with this supplier before archiving it.',
            code: 'supplier_has_balance',
          });
        }
        const data: Prisma.SupplierUpdateInput = {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.phone !== undefined ? { phone: blank(input.phone) } : {}),
          ...(input.address !== undefined
            ? { address: blank(input.address) }
            : {}),
          ...(input.note !== undefined ? { note: blank(input.note) } : {}),
          ...(input.archived !== undefined
            ? { archivedAt: input.archived ? new Date() : null }
            : {}),
        };
        await db.supplier.update({ where: { id: supplierId }, data });
        await this.audit.record(
          {
            action: 'supplier.updated',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'supplier',
            entityId: supplierId,
            before: {
              name: before.name,
              phone: before.phone,
              address: before.address,
              note: before.note,
              archived: before.archivedAt !== null,
            },
            after: { ...input },
            client,
          },
          db,
        );
      });
    } catch (err) {
      throw this.nameTaken(err);
    }
    return this.get(ctx, supplierId);
  }

  /** The supplier's account, newest first. */
  async entries(
    ctx: ShopContext,
    supplierId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<{ entries: SupplierEntryView[]; nextCursor: string | null }> {
    const db = scopedToShop(this.prisma, ctx.shopId);
    await this.get(ctx, supplierId);
    const limit = query.limit ?? 50;
    const rows = await db.supplierLedgerEntry.findMany({
      where: {
        supplierId,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: {
        purchase: { select: { number: true } },
        payment: { select: { reversedAt: true } },
      },
    });
    const page = rows.slice(0, limit);
    const names = await this.actorNames(
      ctx,
      page.map((e) => e.createdByMembershipId),
    );
    return {
      entries: page.map((e) => this.entryView(e, names, this.money(ctx))),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Records a payment to a supplier. A payment cannot be more than the
   * shop owes (A-028). Retrying with the same key returns the first result.
   */
  async recordPayment(
    ctx: ShopContext,
    supplierId: string,
    input: PaymentRequest & { idempotencyKey: string },
    client: ClientInfo,
  ): Promise<SupplierPaymentView> {
    const { idempotencyKey, ...payment } = input;
    const hash = hashOf({ supplierId, ...this.normalise(payment) });
    const db = scopedToShop(this.prisma, ctx.shopId);
    const replay = await this.replay(ctx, idempotencyKey, hash);
    if (replay) return replay;
    try {
      const created = await db.$transaction(async (tx) => {
        const row = await this.recordPaymentInTx(tx, ctx, {
          supplierId,
          payment,
          idempotencyKey,
          requestHash: hash,
        });
        await this.audit.record(
          {
            action: 'supplier.payment_recorded',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'supplier',
            entityId: supplierId,
            after: {
              paymentId: row.id,
              amount: payment.amount,
              method: payment.method,
              reference: payment.reference ?? null,
            },
            client,
          },
          tx,
        );
        return row;
      });
      return this.paymentView(ctx, created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.replay(ctx, idempotencyKey, hash);
        if (raced) return raced;
      }
      throw err;
    }
  }

  /**
   * Writes a payment and its ledger entry in the caller's transaction (also
   * used when a purchase is paid as it is received). The caller audits.
   */
  async recordPaymentInTx(
    tx: ShopScopedTx,
    ctx: ShopContext,
    req: {
      supplierId: string;
      payment: PaymentRequest;
      purchaseId?: string;
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<SupplierPayment> {
    const balance = await this.ledger.lockInShop(
      tx,
      ctx.shopId,
      req.supplierId,
    );
    const amount = new Prisma.Decimal(req.payment.amount);
    if (amount.gt(balance)) {
      throw new ConflictException({
        message: `This is more than the TZS ${shillings(balance.isNegative() ? new Prisma.Decimal(0) : balance)} owed to the supplier.`,
        code: 'payment_exceeds_balance',
      });
    }
    const id = newId();
    const row = await tx.supplierPayment.create({
      data: {
        id,
        shopId: ctx.shopId,
        supplierId: req.supplierId,
        amount,
        method: req.payment.method,
        reference: blank(req.payment.reference) ?? null,
        note: blank(req.payment.note) ?? null,
        purchaseId: req.purchaseId ?? null,
        idempotencyKey: req.idempotencyKey,
        requestHash: req.requestHash,
        createdByMembershipId: ctx.membershipId,
      },
    });
    await this.ledger.post(tx, ctx, {
      supplierId: req.supplierId,
      type: SupplierEntryType.PAYMENT,
      amount: amount.negated().toFixed(0),
      paymentId: id,
      purchaseId: null,
    });
    return row;
  }

  /**
   * Reverses a payment recorded by mistake: the payment is marked reversed
   * and the amount goes back on the supplier's account. Reversing twice
   * changes nothing.
   */
  async reversePayment(
    ctx: ShopContext,
    supplierId: string,
    paymentId: string,
    reason: string,
    client: ClientInfo,
  ): Promise<SupplierPaymentView> {
    const db = scopedToShop(this.prisma, ctx.shopId);
    const result = await db.$transaction(async (tx) => {
      await this.ledger.lockInShop(tx, ctx.shopId, supplierId);
      const payment = await tx.supplierPayment.findUnique({
        where: { id: paymentId },
      });
      if (!payment || payment.supplierId !== supplierId) {
        throw paymentNotFound();
      }
      if (payment.reversedAt) return payment;
      const updated = await tx.supplierPayment.update({
        where: { id: paymentId },
        data: {
          reversedAt: new Date(),
          reversedByMembershipId: ctx.membershipId,
          reverseReason: reason.trim(),
        },
      });
      await this.ledger.post(tx, ctx, {
        supplierId,
        type: SupplierEntryType.PAYMENT_REVERSED,
        amount: payment.amount.toFixed(0),
        paymentId,
        note: reason.trim(),
      });
      await this.audit.record(
        {
          action: 'supplier.payment_reversed',
          shopId: ctx.shopId,
          actorUserId: ctx.userId,
          actorMembershipId: ctx.membershipId,
          entityType: 'supplier',
          entityId: supplierId,
          after: {
            paymentId,
            amount: payment.amount.toFixed(0),
            reason: reason.trim(),
          },
          client,
        },
        tx,
      );
      return updated;
    });
    return this.paymentView(ctx, result);
  }

  /** Payments recorded with a purchase (for the purchase page). */
  async paymentsForPurchase(
    ctx: ShopContext,
    purchaseId: string,
  ): Promise<SupplierPaymentView[]> {
    const rows = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).supplierPayment.findMany({
      where: { purchaseId },
      orderBy: { id: 'asc' },
    });
    const names = await this.actorNames(
      ctx,
      rows.map((r) => r.createdByMembershipId),
    );
    return rows.map((r) => this.toPaymentView(r, names, this.money(ctx)));
  }

  /**
   * Compares every supplier's stored balance with the sum of its ledger
   * entries. An empty mismatch list means they agree.
   */
  async reconciliation(ctx: ShopContext): Promise<SupplierReconciliation> {
    const rows = await this.prisma.$queryRaw<
      { id: string; name: string; balance: string; ledger: string }[]
    >`
      SELECT s.id, s.name, s.balance::text AS balance,
             coalesce(sum(e.amount), 0)::text AS ledger
      FROM suppliers s
      LEFT JOIN supplier_ledger_entries e
        ON e.shop_id = s.shop_id AND e.supplier_id = s.id
      WHERE s.shop_id = ${ctx.shopId}::uuid
      GROUP BY s.id, s.name, s.balance
      ORDER BY s.name`;
    return {
      checkedSuppliers: rows.length,
      mismatches: rows
        .filter((r) => new Prisma.Decimal(r.balance).cmp(r.ledger) !== 0)
        .map((r) => ({
          supplierId: r.id,
          supplierName: r.name,
          balance: new Prisma.Decimal(r.balance).toFixed(0),
          ledgerTotal: new Prisma.Decimal(r.ledger).toFixed(0),
        })),
    };
  }

  // ---- helpers ----

  private normalise(p: PaymentRequest) {
    return {
      amount: new Prisma.Decimal(p.amount).toFixed(0),
      method: p.method,
      reference: blank(p.reference) ?? null,
      note: blank(p.note) ?? null,
    };
  }

  private async replay(
    ctx: ShopContext,
    key: string,
    hash: string,
  ): Promise<SupplierPaymentView | null> {
    const existing = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).supplierPayment.findFirst({ where: { idempotencyKey: key } });
    if (!existing) return null;
    if (existing.requestHash !== hash) {
      throw new ConflictException({
        message: 'This request key was already used for a different payment.',
        code: 'idempotency_conflict',
      });
    }
    return this.paymentView(ctx, existing);
  }

  private nameTaken(err: unknown): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException({
        message: 'A supplier with this name already exists.',
        code: 'supplier_name_taken',
      });
    }
    return err;
  }

  /** Balances and amounts are shown only to people who can see costs (A-030). */
  money(ctx: ShopContext): boolean {
    return this.authorization.canSeeCosts(ctx);
  }

  private view(s: Supplier, money: boolean): SupplierView {
    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      address: s.address,
      note: s.note,
      balance: money ? shillings(s.balance) : null,
      archived: s.archivedAt !== null,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private entryView(
    e: SupplierLedgerEntry & {
      purchase: { number: number } | null;
      payment: { reversedAt: Date | null } | null;
    },
    names: Map<string, string>,
    money: boolean,
  ): SupplierEntryView {
    return {
      id: e.id,
      type: e.type,
      amount: money ? shillings(e.amount) : null,
      balanceAfter: money ? shillings(e.balanceAfter) : null,
      purchaseId: e.purchaseId,
      purchaseNumber: e.purchase?.number ?? null,
      paymentId: e.paymentId,
      paymentReversed: e.payment?.reversedAt != null,
      note: e.note,
      actorName: names.get(e.createdByMembershipId) ?? null,
      createdAt: e.createdAt.toISOString(),
    };
  }

  private async paymentView(
    ctx: ShopContext,
    p: SupplierPayment,
  ): Promise<SupplierPaymentView> {
    const names = await this.actorNames(ctx, [p.createdByMembershipId]);
    return this.toPaymentView(p, names, this.money(ctx));
  }

  private toPaymentView(
    p: SupplierPayment,
    names: Map<string, string>,
    money: boolean,
  ): SupplierPaymentView {
    return {
      id: p.id,
      supplierId: p.supplierId,
      amount: money ? shillings(p.amount) : null,
      method: p.method,
      reference: p.reference,
      note: p.note,
      purchaseId: p.purchaseId,
      reversed: p.reversedAt !== null,
      reverseReason: p.reverseReason,
      actorName: names.get(p.createdByMembershipId) ?? null,
      createdAt: p.createdAt.toISOString(),
    };
  }

  async actorNames(
    ctx: ShopContext,
    membershipIds: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(membershipIds.filter((i): i is string => !!i))];
    if (ids.length === 0) return new Map();
    const members = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).shopMembership.findMany({
      where: { id: { in: ids } },
      select: { id: true, user: { select: { fullName: true } } },
    });
    return new Map(members.map((m) => [m.id, m.user.fullName]));
  }
}
