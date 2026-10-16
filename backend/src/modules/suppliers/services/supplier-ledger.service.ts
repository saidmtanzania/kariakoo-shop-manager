import { Injectable, NotFoundException } from '@nestjs/common';
import type { ShopContext } from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  Prisma,
  SupplierEntryType,
  type ShopScopedTx,
  type SupplierLedgerEntry,
} from '../../../database/index.js';

export interface SupplierEntryRequest {
  supplierId: string;
  type: SupplierEntryType;
  /** Whole shillings; positive increases what the shop owes. */
  amount: string;
  purchaseId?: string | null;
  paymentId?: string | null;
  note?: string | null;
}

const supplierNotFound = () =>
  new NotFoundException({
    message: 'Supplier not found.',
    code: 'supplier_not_found',
  });

/**
 * The only writer of supplier balances and the supplier ledger. Every
 * change locks the supplier row, writes one entry with the balance after
 * it and updates the stored balance in the caller's transaction, so the
 * balance always equals the sum of the ledger. An architecture test fails
 * if any other file writes either.
 */
@Injectable()
export class SupplierLedgerService {
  async post(
    db: ShopScopedTx,
    ctx: ShopContext,
    req: SupplierEntryRequest,
  ): Promise<SupplierLedgerEntry> {
    const before = await this.lockInShop(db, ctx.shopId, req.supplierId);
    const amount = new Prisma.Decimal(req.amount);
    if (amount.isZero()) throw new Error('A supplier entry cannot be zero');
    const after = before.plus(amount);
    await db.supplier.update({
      where: { id: req.supplierId },
      data: { balance: after },
    });
    return db.supplierLedgerEntry.create({
      data: {
        id: newId(),
        shopId: ctx.shopId,
        supplierId: req.supplierId,
        type: req.type,
        amount,
        balanceAfter: after,
        purchaseId: req.purchaseId ?? null,
        paymentId: req.paymentId ?? null,
        note: req.note ?? null,
        createdByMembershipId: ctx.membershipId,
      },
    });
  }

  /** Locks a supplier of this shop; another shop's supplier is not found. */
  async lockInShop(
    db: ShopScopedTx,
    shopId: string,
    supplierId: string,
  ): Promise<Prisma.Decimal> {
    const rows = await db.$queryRaw<{ balance: string }[]>`
      SELECT balance::text AS balance FROM suppliers
      WHERE id = ${supplierId}::uuid AND shop_id = ${shopId}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw supplierNotFound();
    return new Prisma.Decimal(row.balance);
  }
}
