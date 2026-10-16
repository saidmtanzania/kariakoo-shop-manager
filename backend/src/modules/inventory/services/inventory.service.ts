import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  QuantityError,
  toBaseQuantity,
  type AdjustmentKind,
  type InventorySummary,
  type ReconciliationResult,
  type StockMovementView,
} from '@ksm/shared';
import { createHash } from 'node:crypto';
import type {
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  AdjustmentReason,
  Prisma,
  PrismaService,
  scopedToShop,
  type ShopScopedTx,
  type StockMovement,
} from '../../../database/index.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { AuthorizationService } from '../../authorization/services/authorization.service.js';
import { costPerBaseUnit } from '../domain/costing.js';
import { StockLedgerService } from './stock-ledger.service.js';

export interface AdjustmentRequest {
  productId: string;
  unitId: string;
  kind: AdjustmentKind;
  quantity: string;
  reason: AdjustmentReason;
  note?: string | null;
  unitCost?: string | null;
  idempotencyKey: string;
}

export interface AdjustmentResult {
  adjustmentId: string;
  movement: StockMovementView;
}

/** A unit as needed to record stock in it. */
export interface StockUnit {
  id: string;
  name: string;
  conversion: string;
  allowFraction: boolean;
}

const productNotFound = () =>
  new NotFoundException({
    message: 'Product not found.',
    code: 'product_not_found',
  });

const unitNotFound = () =>
  new NotFoundException({
    message: 'This unit does not belong to the product.',
    code: 'unit_not_found',
  });

/** Turns a unit-rule violation (D-013) into a 422 the screens can explain. */
export function baseQuantityOrThrow(
  quantity: string,
  unit: StockUnit,
  baseAllowsFraction: boolean,
): string {
  try {
    return toBaseQuantity(quantity, unit, baseAllowsFraction);
  } catch (err) {
    if (err instanceof QuantityError) {
      throw new UnprocessableEntityException({
        message:
          err.code === 'fraction_not_allowed'
            ? `${unit.name} is counted in whole numbers.`
            : 'This quantity does not convert to a whole number of base units.',
        code: err.code,
      });
    }
    throw err;
  }
}

function requestHash(req: AdjustmentRequest): string {
  const { idempotencyKey: _ignored, ...rest } = req;
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...rest,
        note: rest.note ?? null,
        unitCost: rest.unitCost ?? null,
      }),
    )
    .digest('hex');
}

const dec = (v: Prisma.Decimal | string) =>
  typeof v === 'string' ? v : v.toFixed();

/**
 * Stock adjustments, opening stock, movement history, low-stock summary,
 * reconciliation and the negative-stock setting (WF-06, D-007).
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Records an adjustment: add, remove or set the counted quantity, in any
   * unit, with a reason. Adjustments never take stock below zero, whatever
   * the shop's sales setting (a count cannot be negative, and a loss larger
   * than the stock on record means the record needs a count instead).
   * Retrying with the same key returns the first result.
   */
  async adjust(
    ctx: ShopContext,
    req: AdjustmentRequest,
    client: ClientInfo,
  ): Promise<AdjustmentResult> {
    if (req.kind !== 'count' && !/[1-9]/.test(req.quantity)) {
      throw new BadRequestException({
        message: 'Enter a quantity more than zero.',
        code: 'quantity_required',
      });
    }
    if (req.reason === AdjustmentReason.OTHER && !req.note?.trim()) {
      throw new BadRequestException({
        message: 'Explain the reason in the note.',
        code: 'note_required',
      });
    }
    if (req.unitCost && !this.authorization.canSeeCosts(ctx)) {
      throw new ForbiddenException({
        message: 'You cannot enter costs.',
        code: 'permission_denied',
      });
    }
    if (req.unitCost && req.kind !== 'add') {
      throw new UnprocessableEntityException({
        message: 'A cost can only be given when adding stock.',
        code: 'cost_only_for_added_stock',
      });
    }
    const hash = requestHash(req);
    const db = scopedToShop(this.prisma, ctx.shopId);
    const replay = await this.replay(ctx, db, req.idempotencyKey, hash);
    if (replay) return replay;

    const adjustmentId = newId();
    try {
      const movement = await db.$transaction(async (tx) => {
        const { unit, base } = await this.loadUnit(
          tx,
          req.productId,
          req.unitId,
        );
        const baseQuantity = baseQuantityOrThrow(
          req.quantity,
          unit,
          base.allowFraction,
        );
        const change =
          req.kind === 'count'
            ? ({ kind: 'set', quantity: baseQuantity } as const)
            : ({
                kind: 'delta',
                quantity:
                  req.kind === 'remove' ? `-${baseQuantity}` : baseQuantity,
              } as const);
        await tx.stockAdjustment.create({
          data: {
            id: adjustmentId,
            shopId: ctx.shopId,
            reason: req.reason,
            note: req.note ?? null,
            idempotencyKey: req.idempotencyKey,
            requestHash: hash,
            createdByMembershipId: ctx.membershipId,
          },
        });
        const result = await this.ledger.apply(tx, ctx, {
          productId: req.productId,
          locationId: await this.ledger.defaultLocationId(tx),
          type: 'ADJUSTMENT',
          change,
          unitCost: req.unitCost
            ? costPerBaseUnit(req.unitCost, unit.conversion)
            : null,
          entered: {
            unitId: unit.id,
            unitName: unit.name,
            quantity: req.quantity,
            conversion: unit.conversion,
          },
          adjustmentId,
          reason: req.reason,
          note: req.note ?? null,
          allowNegative: false,
        });
        await this.audit.record(
          {
            action: 'inventory.adjusted',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'product',
            entityId: req.productId,
            after: {
              adjustmentId,
              kind: req.kind,
              reason: req.reason,
              unit: unit.name,
              quantity: req.quantity,
              baseChange: result.movement.quantity.toFixed(),
              balanceAfter: result.quantity,
            },
            client,
          },
          tx,
        );
        return result.movement;
      });
      return {
        adjustmentId,
        movement: await this.toView(ctx, movement),
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // A concurrent retry with the same key won the race.
        const raced = await this.replay(ctx, db, req.idempotencyKey, hash);
        if (raced) return raced;
      }
      throw err;
    }
  }

  /**
   * Records opening stock for a product with no stock history, inside the
   * caller's transaction (also used when a product is created with stock).
   */
  async recordOpening(
    tx: ShopScopedTx,
    ctx: ShopContext,
    input: {
      productId: string;
      unit: StockUnit;
      baseAllowsFraction: boolean;
      quantity: string;
      unitCost?: string | null;
    },
  ): Promise<StockMovement> {
    if (input.unitCost && !this.authorization.canSeeCosts(ctx)) {
      throw new ForbiddenException({
        message: 'You cannot enter costs.',
        code: 'permission_denied',
      });
    }
    const baseQuantity = baseQuantityOrThrow(
      input.quantity,
      input.unit,
      input.baseAllowsFraction,
    );
    const result = await this.ledger.apply(tx, ctx, {
      productId: input.productId,
      locationId: await this.ledger.defaultLocationId(tx),
      type: 'OPENING',
      change: { kind: 'delta', quantity: baseQuantity },
      unitCost: input.unitCost
        ? costPerBaseUnit(input.unitCost, input.unit.conversion)
        : null,
      entered: {
        unitId: input.unit.id,
        unitName: input.unit.name,
        quantity: input.quantity,
        conversion: input.unit.conversion,
      },
      allowNegative: false,
      requireNoHistory: true,
    });
    return result.movement;
  }

  /** Opening stock for an existing product (once, before any other movement). */
  async opening(
    ctx: ShopContext,
    productId: string,
    input: { unitId: string; quantity: string; unitCost?: string | null },
    client: ClientInfo,
  ): Promise<StockMovementView> {
    const movement = await scopedToShop(this.prisma, ctx.shopId).$transaction(
      async (tx) => {
        const { unit, base } = await this.loadUnit(tx, productId, input.unitId);
        const movement = await this.recordOpening(tx, ctx, {
          productId,
          unit,
          baseAllowsFraction: base.allowFraction,
          quantity: input.quantity,
          unitCost: input.unitCost,
        });
        await this.audit.record(
          {
            action: 'inventory.opening_recorded',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'product',
            entityId: productId,
            after: {
              unit: unit.name,
              quantity: input.quantity,
              baseQuantity: movement.quantity.toFixed(),
            },
            client,
          },
          tx,
        );
        return movement;
      },
    );
    return this.toView(ctx, movement);
  }

  /** Movement history, newest first; ids are UUID v7, so they are the cursor. */
  async movements(
    ctx: ShopContext,
    query: { productId?: string; cursor?: string; limit?: number },
  ): Promise<{ movements: StockMovementView[]; nextCursor: string | null }> {
    const limit = query.limit ?? 50;
    const rows = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).stockMovement.findMany({
      where: {
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { product: { select: { name: true } } },
    });
    const page = rows.slice(0, limit);
    const names = await this.actorNames(
      ctx,
      page.map((m) => m.createdByMembershipId),
    );
    const costs = this.authorization.canSeeCosts(ctx);
    return {
      movements: page.map((m) => this.view(m, m.product.name, names, costs)),
      nextCursor: rows.length > limit ? page.at(-1)!.id : null,
    };
  }

  /** Counts for the stock page and low-stock alerts. */
  async summary(ctx: ShopContext): Promise<InventorySummary> {
    const [row] = await this.prisma.$queryRaw<
      {
        products: bigint;
        low: bigint;
        out: bigint;
        negative: bigint;
        allow_negative: boolean;
      }[]
    >`
      SELECT count(*) AS products,
             count(*) FILTER (WHERE p.reorder_level IS NOT NULL
                                AND coalesce(b.quantity, 0) <= p.reorder_level) AS low,
             count(*) FILTER (WHERE coalesce(b.quantity, 0) = 0) AS out,
             count(*) FILTER (WHERE coalesce(b.quantity, 0) < 0) AS negative,
             (SELECT allow_negative_stock FROM shops WHERE id = ${ctx.shopId}::uuid) AS allow_negative
      FROM products p
      LEFT JOIN stock_balances b ON b.shop_id = p.shop_id AND b.product_id = p.id
      WHERE p.shop_id = ${ctx.shopId}::uuid AND p.archived_at IS NULL`;
    return {
      productCount: Number(row?.products ?? 0),
      lowStockCount: Number(row?.low ?? 0),
      outOfStockCount: Number(row?.out ?? 0),
      negativeCount: Number(row?.negative ?? 0),
      allowNegativeStock: row?.allow_negative ?? false,
    };
  }

  /**
   * Compares every balance with the sum of its movements (AC-05). An empty
   * mismatch list means the ledger and the balances agree.
   */
  async reconciliation(ctx: ShopContext): Promise<ReconciliationResult> {
    const rows = await this.prisma.$queryRaw<
      {
        product_id: string;
        name: string;
        balance: string;
        ledger: string;
      }[]
    >`
      SELECT p.id AS product_id, p.name,
             coalesce(b.quantity, 0)::text AS balance,
             coalesce(m.total, 0)::text AS ledger
      FROM products p
      LEFT JOIN (SELECT product_id, sum(quantity) AS quantity
                 FROM stock_balances WHERE shop_id = ${ctx.shopId}::uuid
                 GROUP BY product_id) b ON b.product_id = p.id
      LEFT JOIN (SELECT product_id, sum(quantity) AS total
                 FROM stock_movements WHERE shop_id = ${ctx.shopId}::uuid
                 GROUP BY product_id) m ON m.product_id = p.id
      WHERE p.shop_id = ${ctx.shopId}::uuid
      ORDER BY p.name`;
    return {
      checkedProducts: rows.length,
      mismatches: rows
        .filter((r) => new Prisma.Decimal(r.balance).cmp(r.ledger) !== 0)
        .map((r) => ({
          productId: r.product_id,
          productName: r.name,
          balance: new Prisma.Decimal(r.balance).toFixed(3),
          ledgerTotal: new Prisma.Decimal(r.ledger).toFixed(3),
        })),
    };
  }

  async settings(ctx: ShopContext): Promise<{ allowNegativeStock: boolean }> {
    const shop = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).shop.findUniqueOrThrow({
      where: { id: ctx.shopId },
      select: { allowNegativeStock: true },
    });
    return { allowNegativeStock: shop.allowNegativeStock };
  }

  /** The owner's choice whether sales may take stock below zero (D-007). */
  async updateSettings(
    ctx: ShopContext,
    input: { allowNegativeStock: boolean },
    client: ClientInfo,
  ): Promise<{ allowNegativeStock: boolean }> {
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      const before = await db.shop.findUniqueOrThrow({
        where: { id: ctx.shopId },
        select: { allowNegativeStock: true },
      });
      await db.shop.update({
        where: { id: ctx.shopId },
        data: { allowNegativeStock: input.allowNegativeStock },
      });
      await this.audit.record(
        {
          action: 'inventory.settings_updated',
          shopId: ctx.shopId,
          actorUserId: ctx.userId,
          actorMembershipId: ctx.membershipId,
          entityType: 'shop',
          entityId: ctx.shopId,
          before,
          after: { allowNegativeStock: input.allowNegativeStock },
          client,
        },
        db,
      );
    });
    return { allowNegativeStock: input.allowNegativeStock };
  }

  // ---- helpers ----

  private async replay(
    ctx: ShopContext,
    db: ReturnType<typeof scopedToShop>,
    key: string,
    hash: string,
  ): Promise<AdjustmentResult | null> {
    const existing = await db.stockAdjustment.findFirst({
      where: { idempotencyKey: key },
      include: { movements: true },
    });
    if (!existing) return null;
    if (existing.requestHash !== hash) {
      throw new ConflictException({
        message:
          'This request key was already used for a different adjustment.',
        code: 'idempotency_conflict',
      });
    }
    const movement = existing.movements[0];
    if (!movement) throw new Error('Adjustment without a movement');
    return {
      adjustmentId: existing.id,
      movement: await this.toView(ctx, movement),
    };
  }

  /** The product's unit and base unit; archived products and units are refused. */
  private async loadUnit(
    tx: ShopScopedTx,
    productId: string,
    unitId: string,
  ): Promise<{ unit: StockUnit; base: StockUnit }> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { units: true },
    });
    if (!product) throw productNotFound();
    if (product.archivedAt) {
      throw new ConflictException({
        message: 'This product is archived. Restore it first.',
        code: 'product_archived',
      });
    }
    const unit = product.units.find((u) => u.id === unitId);
    if (!unit || unit.archivedAt) throw unitNotFound();
    const base = product.units.find((u) => u.isBase);
    if (!base) throw new Error(`Product ${productId} has no base unit`);
    const toStock = (u: typeof unit): StockUnit => ({
      id: u.id,
      name: u.name,
      conversion: dec(u.conversion),
      allowFraction: u.allowFraction,
    });
    return { unit: toStock(unit), base: toStock(base) };
  }

  private async toView(
    ctx: ShopContext,
    movement: StockMovement,
  ): Promise<StockMovementView> {
    const product = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).product.findUniqueOrThrow({
      where: { id: movement.productId },
      select: { name: true },
    });
    const names = await this.actorNames(ctx, [movement.createdByMembershipId]);
    return this.view(
      movement,
      product.name,
      names,
      this.authorization.canSeeCosts(ctx),
    );
  }

  private view(
    m: StockMovement,
    productName: string,
    names: Map<string, string>,
    canSeeCosts: boolean,
  ): StockMovementView {
    return {
      id: m.id,
      productId: m.productId,
      productName,
      type: m.type,
      quantity: m.quantity.toFixed(3),
      balanceAfter: m.balanceAfter.toFixed(3),
      unitName: m.unitName,
      unitQuantity: m.unitQuantity.toFixed(3),
      conversion: m.conversion.toFixed(3),
      unitCost: canSeeCosts ? m.unitCost.toFixed(4) : null,
      reason: m.reason,
      note: m.note,
      actorName: names.get(m.createdByMembershipId) ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private async actorNames(
    ctx: ShopContext,
    membershipIds: string[],
  ): Promise<Map<string, string>> {
    const members = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).shopMembership.findMany({
      where: { id: { in: [...new Set(membershipIds)] } },
      select: { id: true, user: { select: { fullName: true } } },
    });
    return new Map(members.map((m) => [m.id, m.user.fullName]));
  }
}
