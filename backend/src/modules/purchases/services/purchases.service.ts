import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  allocateCharges,
  landedCostPerBase,
  lineTotal,
  PurchaseRuleError,
  sumAmounts,
  type PurchaseChargeView,
  type PurchaseDetail,
  type PurchaseLineView,
  type PurchaseListItem,
  type PurchaseStatus,
  type SupplierPaymentMethod,
} from '@ksm/shared';
import { createHash } from 'node:crypto';
import type {
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  nextShopNumber,
  Prisma,
  PrismaService,
  PurchaseStatus as DbPurchaseStatus,
  scopedToShop,
  SupplierEntryType,
  type Purchase,
  type PurchaseCharge,
  type PurchaseLine,
  type ShopScopedTx,
} from '../../../database/index.js';
import { AuditService } from '../../audit/services/audit.service.js';
import {
  baseQuantityOrThrow,
  InventoryService,
} from '../../inventory/services/inventory.service.js';
import { StockLedgerService } from '../../inventory/services/stock-ledger.service.js';
import { SupplierLedgerService } from '../../suppliers/services/supplier-ledger.service.js';
import { SuppliersService } from '../../suppliers/services/suppliers.service.js';

export interface PurchaseBody {
  supplierId: string;
  supplierReference?: string | null;
  note?: string | null;
  lines: {
    productId: string;
    unitId: string;
    quantity: string;
    unitCost: string;
  }[];
  charges: { description: string; amount: string }[];
}

export interface ReceiveRequest {
  payment?: {
    amount: string;
    method: SupplierPaymentMethod;
    reference?: string | null;
  } | null;
}

const purchaseNotFound = () =>
  new NotFoundException({
    message: 'Purchase not found.',
    code: 'purchase_not_found',
  });

const blank = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
const shillings = (v: Prisma.Decimal) => v.toFixed(0);

/** Normalised so equal requests hash equally. */
function normalise(body: PurchaseBody) {
  return {
    supplierId: body.supplierId,
    supplierReference: blank(body.supplierReference),
    note: blank(body.note),
    lines: body.lines.map((l) => ({
      productId: l.productId,
      unitId: l.unitId,
      quantity: new Prisma.Decimal(l.quantity).toFixed(3),
      unitCost: new Prisma.Decimal(l.unitCost).toFixed(0),
    })),
    charges: body.charges.map((c) => ({
      description: c.description.trim(),
      amount: new Prisma.Decimal(c.amount).toFixed(0),
    })),
  };
}

const hashOf = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Purchases (Phase 06). A purchase is a draft until the goods arrive; it
 * is then received as it actually arrived (D-014): stock comes in at the
 * landed cost including extra costs (D-015) and the supplier's account is
 * charged, all in one transaction. A received purchase is never edited;
 * cancelling it reverses its stock and its charge.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly stock: StockLedgerService,
    private readonly supplierLedger: SupplierLedgerService,
    private readonly suppliers: SuppliersService,
    private readonly audit: AuditService,
  ) {}

  async list(
    ctx: ShopContext,
    query: {
      status?: PurchaseStatus;
      supplierId?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<{ purchases: PurchaseListItem[]; nextCursor: string | null }> {
    const limit = query.limit ?? 30;
    const money = this.suppliers.money(ctx);
    const rows = await scopedToShop(this.prisma, ctx.shopId).purchase.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: {
        supplier: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    });
    const page = rows.slice(0, limit);
    return {
      purchases: page.map((p) =>
        this.listItem(p, p.supplier.name, p._count.lines, money),
      ),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(ctx: ShopContext, purchaseId: string): Promise<PurchaseDetail> {
    const db = scopedToShop(this.prisma, ctx.shopId);
    const p = await db.purchase.findUnique({
      where: { id: purchaseId },
      include: {
        supplier: { select: { name: true } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: { product: { select: { name: true } } },
        },
        charges: { orderBy: { id: 'asc' } },
      },
    });
    if (!p) throw purchaseNotFound();
    const names = await this.suppliers.actorNames(ctx, [
      p.createdByMembershipId,
      p.receivedByMembershipId,
      p.cancelledByMembershipId,
    ]);
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    const money = this.suppliers.money(ctx);
    return {
      ...this.listItem(p, p.supplier.name, p.lines.length, money),
      note: p.note,
      subtotal: money ? shillings(p.subtotal) : null,
      extraCosts: money ? shillings(p.extraCosts) : null,
      lines: p.lines.map((l) => this.lineView(l, l.product.name, money)),
      charges: p.charges.map((c) => this.chargeView(c, money)),
      payments: await this.suppliers.paymentsForPurchase(ctx, p.id),
      createdByName: name(p.createdByMembershipId),
      receivedByName: name(p.receivedByMembershipId),
      cancelledByName: name(p.cancelledByMembershipId),
      cancelReason: p.cancelReason,
    };
  }

  /**
   * Saves a new draft. Retrying with the same key returns the first draft;
   * the same key with different content is refused.
   */
  async create(
    ctx: ShopContext,
    body: PurchaseBody & { idempotencyKey: string },
    client: ClientInfo,
  ): Promise<PurchaseDetail> {
    this.assertCanEnterCosts(ctx);
    const { idempotencyKey, ...rest } = body;
    const hash = hashOf(normalise(rest));
    const replay = await this.replay(ctx, idempotencyKey, hash);
    if (replay) return replay;
    const id = newId();
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (tx) => {
        await this.activeSupplier(tx, rest.supplierId);
        const number = await nextShopNumber(tx, ctx.shopId, 'purchase');
        await tx.purchase.create({
          data: {
            id,
            shopId: ctx.shopId,
            number,
            supplierId: rest.supplierId,
            supplierReference: blank(rest.supplierReference),
            note: blank(rest.note),
            idempotencyKey,
            requestHash: hash,
            createdByMembershipId: ctx.membershipId,
          },
        });
        const totals = await this.writeParts(tx, ctx, id, rest);
        await tx.purchase.update({ where: { id }, data: totals });
        await this.audit.record(
          {
            action: 'purchase.created',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'purchase',
            entityId: id,
            after: { number, supplierId: rest.supplierId, total: totals.total },
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
        const raced = await this.replay(ctx, idempotencyKey, hash);
        if (raced) return raced;
      }
      throw err;
    }
    return this.get(ctx, id);
  }

  /** Replaces a draft's supplier, lines and extra costs. */
  async update(
    ctx: ShopContext,
    purchaseId: string,
    body: PurchaseBody,
    client: ClientInfo,
  ): Promise<PurchaseDetail> {
    this.assertCanEnterCosts(ctx);
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (tx) => {
      const purchase = await this.lock(tx, ctx.shopId, purchaseId);
      if (purchase.status !== DbPurchaseStatus.DRAFT) {
        throw new ConflictException({
          message: 'Only a draft purchase can be changed.',
          code: 'purchase_not_draft',
        });
      }
      await this.activeSupplier(tx, body.supplierId);
      await tx.purchaseLine.deleteMany({ where: { purchaseId } });
      await tx.purchaseCharge.deleteMany({ where: { purchaseId } });
      const totals = await this.writeParts(tx, ctx, purchaseId, body);
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          supplierId: body.supplierId,
          supplierReference: blank(body.supplierReference),
          note: blank(body.note),
          ...totals,
        },
      });
      await this.audit.record(
        {
          action: 'purchase.updated',
          shopId: ctx.shopId,
          actorUserId: ctx.userId,
          actorMembershipId: ctx.membershipId,
          entityType: 'purchase',
          entityId: purchaseId,
          before: { total: shillings(purchase.total) },
          after: { supplierId: body.supplierId, total: totals.total },
          client,
        },
        tx,
      );
    });
    return this.get(ctx, purchaseId);
  }

  /**
   * Receives a draft: stock comes in for every line at its landed cost,
   * the supplier's account is charged the total, and an optional payment
   * made on the spot is recorded, all in one transaction. Receiving a
   * purchase that is already received changes nothing and returns it, so
   * a retry or a second click cannot receive the goods twice.
   */
  async receive(
    ctx: ShopContext,
    purchaseId: string,
    req: ReceiveRequest,
    client: ClientInfo,
  ): Promise<PurchaseDetail> {
    if (req.payment && !ctx.permissions.has('supplier_payments.create')) {
      throw new ForbiddenException({
        message: 'You cannot record payments to suppliers.',
        code: 'permission_denied',
      });
    }
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (tx) => {
      const purchase = await this.lock(tx, ctx.shopId, purchaseId);
      if (purchase.status === DbPurchaseStatus.RECEIVED) return;
      if (purchase.status === DbPurchaseStatus.CANCELLED) {
        throw new ConflictException({
          message: 'This purchase was cancelled.',
          code: 'purchase_cancelled',
        });
      }
      await this.activeSupplier(tx, purchase.supplierId);
      const lines = await tx.purchaseLine.findMany({
        where: { purchaseId },
        orderBy: { lineNo: 'asc' },
      });
      const charges = await tx.purchaseCharge.findMany({
        where: { purchaseId },
      });
      const extra = sumAmounts(charges.map((c) => shillings(c.amount)));
      const shares = this.allocate(
        lines.map((l) => shillings(l.lineTotal)),
        extra,
      );
      const costed = lines.map((l, i) => ({
        line: l,
        share: shares[i]!,
        landed: landedCostPerBase(
          shillings(l.lineTotal),
          shares[i]!,
          l.baseQuantity.toFixed(3),
        ),
      }));
      for (const { line, share, landed } of costed) {
        // Units may have been archived since the draft was saved.
        await this.inventory.stockUnit(tx, line.productId, line.unitId);
        await tx.purchaseLine.update({
          where: { id: line.id },
          data: { allocatedExtra: share, landedCostPerBase: landed },
        });
      }
      const locationId = await this.stock.defaultLocationId(tx);
      // Lock balances in product order so concurrent purchases cannot
      // deadlock (A-006).
      for (const { line, landed } of [...costed].sort((a, b) =>
        a.line.productId.localeCompare(b.line.productId),
      )) {
        await this.stock.apply(tx, ctx, {
          productId: line.productId,
          locationId,
          type: 'PURCHASE_RECEIPT',
          change: { kind: 'delta', quantity: line.baseQuantity.toFixed(3) },
          unitCost: landed,
          entered: {
            unitId: line.unitId,
            unitName: line.unitName,
            quantity: line.quantity.toFixed(3),
            conversion: line.conversion.toFixed(3),
          },
          purchaseId,
          allowNegative: false,
        });
      }
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          status: DbPurchaseStatus.RECEIVED,
          receivedAt: new Date(),
          receivedByMembershipId: ctx.membershipId,
        },
      });
      if (!purchase.total.isZero()) {
        await this.supplierLedger.post(tx, ctx, {
          supplierId: purchase.supplierId,
          type: SupplierEntryType.PURCHASE,
          amount: shillings(purchase.total),
          purchaseId,
        });
      }
      let paymentId: string | null = null;
      if (req.payment) {
        const payment = {
          amount: req.payment.amount,
          method: req.payment.method,
          reference: req.payment.reference ?? null,
        };
        const row = await this.suppliers.recordPaymentInTx(tx, ctx, {
          supplierId: purchase.supplierId,
          payment,
          purchaseId,
          idempotencyKey: `purchase:${purchaseId}`,
          requestHash: hashOf({ purchaseId, ...payment }),
        });
        paymentId = row.id;
      }
      await this.audit.record(
        {
          action: 'purchase.received',
          shopId: ctx.shopId,
          actorUserId: ctx.userId,
          actorMembershipId: ctx.membershipId,
          entityType: 'purchase',
          entityId: purchaseId,
          after: {
            number: purchase.number,
            total: shillings(purchase.total),
            extraCosts: extra,
            lines: costed.length,
            paymentId,
            paidNow: req.payment?.amount ?? null,
          },
          client,
        },
        tx,
      );
    });
    return this.get(ctx, purchaseId);
  }

  /**
   * Cancels a purchase. A draft is simply cancelled. A received purchase
   * takes its stock back out at the cost it came in at and credits the
   * supplier's account; this is refused if the stock has already been
   * used (A-027). Payments stay recorded: reverse them separately if the
   * money came back. Cancelling twice changes nothing.
   */
  async cancel(
    ctx: ShopContext,
    purchaseId: string,
    reason: string,
    client: ClientInfo,
  ): Promise<PurchaseDetail> {
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (tx) => {
      const purchase = await this.lock(tx, ctx.shopId, purchaseId);
      if (purchase.status === DbPurchaseStatus.CANCELLED) return;
      const wasReceived = purchase.status === DbPurchaseStatus.RECEIVED;
      if (wasReceived) {
        const lines = await tx.purchaseLine.findMany({
          where: { purchaseId },
          orderBy: { productId: 'asc' },
        });
        const locationId = await this.stock.defaultLocationId(tx);
        for (const line of lines) {
          await this.stock.apply(tx, ctx, {
            productId: line.productId,
            locationId,
            type: 'PURCHASE_REVERSAL',
            change: {
              kind: 'delta',
              quantity: `-${line.baseQuantity.toFixed(3)}`,
            },
            unitCost: line.landedCostPerBase?.toFixed(4) ?? null,
            entered: {
              unitId: line.unitId,
              unitName: line.unitName,
              quantity: line.quantity.toFixed(3),
              conversion: line.conversion.toFixed(3),
            },
            purchaseId,
            note: reason.trim(),
            allowNegative: false,
          });
        }
      }
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          status: DbPurchaseStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledByMembershipId: ctx.membershipId,
          cancelReason: reason.trim(),
        },
      });
      if (wasReceived && !purchase.total.isZero()) {
        await this.supplierLedger.post(tx, ctx, {
          supplierId: purchase.supplierId,
          type: SupplierEntryType.PURCHASE_CANCELLED,
          amount: purchase.total.negated().toFixed(0),
          purchaseId,
          note: reason.trim(),
        });
      }
      await this.audit.record(
        {
          action: 'purchase.cancelled',
          shopId: ctx.shopId,
          actorUserId: ctx.userId,
          actorMembershipId: ctx.membershipId,
          entityType: 'purchase',
          entityId: purchaseId,
          before: { status: purchase.status },
          after: { reason: reason.trim(), stockReversed: wasReceived },
          client,
        },
        tx,
      );
    });
    return this.get(ctx, purchaseId);
  }

  // ---- helpers ----

  /** Writes lines and charges of a draft; returns its totals. */
  private async writeParts(
    tx: ShopScopedTx,
    ctx: ShopContext,
    purchaseId: string,
    body: PurchaseBody,
  ): Promise<{ subtotal: string; extraCosts: string; total: string }> {
    const totals: string[] = [];
    for (const [i, input] of body.lines.entries()) {
      const { unit, base } = await this.inventory.stockUnit(
        tx,
        input.productId,
        input.unitId,
      );
      const baseQuantity = baseQuantityOrThrow(
        input.quantity,
        unit,
        base.allowFraction,
      );
      const total = lineTotal(input.quantity, input.unitCost);
      totals.push(total);
      await tx.purchaseLine.create({
        data: {
          id: newId(),
          shopId: ctx.shopId,
          purchaseId,
          lineNo: i + 1,
          productId: input.productId,
          unitId: unit.id,
          unitName: unit.name,
          conversion: unit.conversion,
          quantity: input.quantity,
          baseQuantity,
          unitCost: input.unitCost,
          lineTotal: total,
        },
      });
    }
    for (const c of body.charges) {
      await tx.purchaseCharge.create({
        data: {
          id: newId(),
          shopId: ctx.shopId,
          purchaseId,
          description: c.description.trim(),
          amount: c.amount,
        },
      });
    }
    const subtotal = sumAmounts(totals);
    const extraCosts = sumAmounts(body.charges.map((c) => c.amount));
    // Checked now so a draft that can never be received is not saved.
    this.allocate(totals, extraCosts);
    return {
      subtotal,
      extraCosts,
      total: sumAmounts([subtotal, extraCosts]),
    };
  }

  /**
   * Writing a purchase means entering buying costs, which only people who
   * can see costs may do (A-030), as with stock added at a cost.
   */
  private assertCanEnterCosts(ctx: ShopContext): void {
    if (!this.suppliers.money(ctx)) {
      throw new ForbiddenException({
        message: 'You cannot enter buying costs.',
        code: 'permission_denied',
      });
    }
  }

  private allocate(lineTotals: string[], extra: string): string[] {
    try {
      return allocateCharges(lineTotals, extra);
    } catch (err) {
      if (err instanceof PurchaseRuleError) {
        throw new UnprocessableEntityException({
          message:
            'Extra costs need goods with a cost to be spread over. Enter the cost of the goods.',
          code: err.code,
        });
      }
      throw err;
    }
  }

  private async activeSupplier(tx: ShopScopedTx, supplierId: string) {
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { archivedAt: true },
    });
    if (!supplier) {
      throw new NotFoundException({
        message: 'Supplier not found.',
        code: 'supplier_not_found',
      });
    }
    if (supplier.archivedAt) {
      throw new ConflictException({
        message: 'This supplier is archived. Restore it first.',
        code: 'supplier_archived',
      });
    }
  }

  /** Locks a purchase of this shop; another shop's purchase is not found. */
  private async lock(
    tx: ShopScopedTx,
    shopId: string,
    purchaseId: string,
  ): Promise<Purchase> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM purchases
      WHERE id = ${purchaseId}::uuid AND shop_id = ${shopId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) throw purchaseNotFound();
    return tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
  }

  private async replay(
    ctx: ShopContext,
    key: string,
    hash: string,
  ): Promise<PurchaseDetail | null> {
    const existing = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).purchase.findFirst({
      where: { idempotencyKey: key },
      select: { id: true, requestHash: true },
    });
    if (!existing) return null;
    if (existing.requestHash !== hash) {
      throw new ConflictException({
        message: 'This request key was already used for a different purchase.',
        code: 'idempotency_conflict',
      });
    }
    return this.get(ctx, existing.id);
  }

  private listItem(
    p: Purchase,
    supplierName: string,
    lineCount: number,
    money: boolean,
  ): PurchaseListItem {
    return {
      id: p.id,
      number: p.number,
      status: p.status,
      supplierId: p.supplierId,
      supplierName,
      supplierReference: p.supplierReference,
      total: money ? shillings(p.total) : null,
      lineCount,
      createdAt: p.createdAt.toISOString(),
      receivedAt: p.receivedAt?.toISOString() ?? null,
      cancelledAt: p.cancelledAt?.toISOString() ?? null,
    };
  }

  private lineView(
    l: PurchaseLine,
    productName: string,
    money: boolean,
  ): PurchaseLineView {
    return {
      id: l.id,
      productId: l.productId,
      productName,
      unitId: l.unitId,
      unitName: l.unitName,
      conversion: l.conversion.toFixed(3),
      quantity: l.quantity.toFixed(3),
      baseQuantity: l.baseQuantity.toFixed(3),
      unitCost: money ? shillings(l.unitCost) : null,
      lineTotal: money ? shillings(l.lineTotal) : null,
      allocatedExtra: money ? shillings(l.allocatedExtra) : null,
      landedCostPerBase: money
        ? (l.landedCostPerBase?.toFixed(4) ?? null)
        : null,
    };
  }

  private chargeView(c: PurchaseCharge, money: boolean): PurchaseChargeView {
    return {
      id: c.id,
      description: c.description,
      amount: money ? shillings(c.amount) : null,
    };
  }
}
