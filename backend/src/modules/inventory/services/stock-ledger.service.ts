import { ConflictException, Injectable } from '@nestjs/common';
import { COST_SCALE, fromScaled, QUANTITY_SCALE, toScaled } from '@ksm/shared';
import type { ShopContext } from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  AdjustmentReason,
  Prisma,
  StockMovementType,
  type ShopScopedTx,
  type StockMovement,
} from '../../../database/index.js';
import { averageAfterReceipt } from '../domain/costing.js';

/** How a movement changes the balance. */
export type StockChange =
  /** Add (positive) or remove (negative) base units. */
  | { kind: 'delta'; quantity: string }
  /** Set the balance to a counted base quantity. */
  | { kind: 'set'; quantity: string };

export interface MovementRequest {
  productId: string;
  locationId: string;
  /** OPENING, or ADJUSTMENT (direction follows the sign of the change). */
  type: 'OPENING' | 'ADJUSTMENT';
  change: StockChange;
  /** Cost per base unit of stock coming in; defaults to the current average. */
  unitCost?: string | null;
  /** The unit, quantity and conversion as the person entered them. */
  entered: {
    unitId: string;
    unitName: string;
    quantity: string;
    conversion: string;
  };
  adjustmentId?: string;
  reason?: AdjustmentReason;
  note?: string | null;
  /** Whether the balance may go below zero (D-007). */
  allowNegative: boolean;
  /** Opening stock: refused once the product has any movement. */
  requireNoHistory?: boolean;
}

export interface MovementResult {
  movement: StockMovement;
  quantity: string;
  averageCost: string;
}

/**
 * The only code that changes stock balances (acceptance criterion AC-05).
 * Every change writes one stock movement in the same transaction, under a
 * row lock on the balance, so concurrent changes serialize and
 * balance = sum of movements always holds. An architecture test fails if
 * any other file writes stock_balances or stock_movements.
 */
@Injectable()
export class StockLedgerService {
  /** Creates a shop's default location (D-002) in the caller's transaction. */
  async createDefaultLocation(
    tx: Prisma.TransactionClient,
    shopId: string,
  ): Promise<void> {
    await tx.stockLocation.create({
      data: { id: newId(), shopId, name: 'Main', isDefault: true },
    });
  }

  async defaultLocationId(db: ShopScopedTx): Promise<string> {
    const location = await db.stockLocation.findFirstOrThrow({
      where: { isDefault: true },
      select: { id: true },
    });
    return location.id;
  }

  /**
   * Applies one change to a product's balance and records the movement.
   * Must run inside a transaction on the shop-scoped client.
   */
  async apply(
    db: ShopScopedTx,
    ctx: ShopContext,
    req: MovementRequest,
  ): Promise<MovementResult> {
    const current = await this.lock(
      db,
      ctx.shopId,
      req.productId,
      req.locationId,
    );

    if (req.requireNoHistory) {
      const history = await db.stockMovement.count({
        where: { productId: req.productId },
      });
      if (history > 0) {
        throw new ConflictException({
          message:
            'This product already has stock records. Use a stock adjustment instead.',
          code: 'opening_stock_exists',
        });
      }
    }

    const before = toScaled(current.quantity, QUANTITY_SCALE);
    const delta =
      req.change.kind === 'delta'
        ? toScaled(req.change.quantity, QUANTITY_SCALE)
        : toScaled(req.change.quantity, QUANTITY_SCALE) - before;
    if (delta === 0n) {
      throw new ConflictException({
        message: 'The counted quantity is the same as the stock on record.',
        code: 'adjustment_no_change',
      });
    }
    const after = before + delta;
    if (after < 0n && !req.allowNegative) {
      throw new ConflictException({
        message: `Not enough stock: ${fromScaled(before, QUANTITY_SCALE)} on record.`,
        code: 'insufficient_stock',
      });
    }

    const incoming = delta > 0n;
    const quantity = fromScaled(delta, QUANTITY_SCALE);
    const unitCost =
      incoming && req.unitCost ? req.unitCost : current.averageCost;
    const averageCost =
      incoming && req.unitCost
        ? averageAfterReceipt(current, { quantity, unitCost })
        : current.averageCost;
    const balanceAfter = fromScaled(after, QUANTITY_SCALE);

    await db.stockBalance.update({
      where: {
        shopId_productId_locationId: {
          shopId: ctx.shopId,
          productId: req.productId,
          locationId: req.locationId,
        },
      },
      data: { quantity: balanceAfter, averageCost },
    });
    const movement = await db.stockMovement.create({
      data: {
        id: newId(),
        shopId: ctx.shopId,
        productId: req.productId,
        locationId: req.locationId,
        type:
          req.type === 'OPENING'
            ? StockMovementType.OPENING
            : incoming
              ? StockMovementType.ADJUSTMENT_IN
              : StockMovementType.ADJUSTMENT_OUT,
        quantity,
        balanceAfter,
        unitCost: fromScaled(toScaled(unitCost, COST_SCALE), COST_SCALE),
        unitId: req.entered.unitId,
        unitName: req.entered.unitName,
        unitQuantity: req.entered.quantity,
        conversion: req.entered.conversion,
        adjustmentId: req.adjustmentId ?? null,
        reason: req.reason ?? null,
        note: req.note ?? null,
        createdByMembershipId: ctx.membershipId,
      },
    });
    return { movement, quantity: balanceAfter, averageCost };
  }

  /**
   * Locks the balance row, creating it at zero first if the product has
   * never had stock. Concurrent changes to one product wait here.
   */
  private async lock(
    db: ShopScopedTx,
    shopId: string,
    productId: string,
    locationId: string,
  ): Promise<{ quantity: string; averageCost: string }> {
    await db.$executeRaw`
      INSERT INTO stock_balances (shop_id, product_id, location_id, quantity, average_cost, updated_at)
      VALUES (${shopId}::uuid, ${productId}::uuid, ${locationId}::uuid, 0, 0, now())
      ON CONFLICT DO NOTHING`;
    const rows = await db.$queryRaw<
      { quantity: string; average_cost: string }[]
    >`
      SELECT quantity::text AS quantity, average_cost::text AS average_cost
      FROM stock_balances
      WHERE shop_id = ${shopId}::uuid AND product_id = ${productId}::uuid
        AND location_id = ${locationId}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error('Stock balance row missing after insert');
    return { quantity: row.quantity, averageCost: row.average_cost };
  }
}
