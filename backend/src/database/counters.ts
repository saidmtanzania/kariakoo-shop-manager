import type { ShopScopedTx } from './tenant-scope.js';

/**
 * The next running number for a shop (purchase numbers now, receipts
 * later), taken in the caller's transaction: concurrent callers wait on the
 * counter row, and a rolled-back transaction gives its number back.
 */
export async function nextShopNumber(
  db: ShopScopedTx,
  shopId: string,
  key: string,
): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO shop_counters (shop_id, key, value)
    VALUES (${shopId}::uuid, ${key}, 1)
    ON CONFLICT (shop_id, key) DO UPDATE SET value = shop_counters.value + 1
    RETURNING value`;
  const row = rows[0];
  if (!row) throw new Error('Counter not returned');
  return Number(row.value);
}
