import {
  COST_SCALE,
  divRoundHalfUp,
  fromScaled,
  QUANTITY_SCALE,
  toScaled,
} from '@ksm/shared';

/**
 * Weighted-average costing (decision D-003, data model section 12). All
 * arithmetic is on scaled integers: quantities at 3 decimals, costs at 4.
 *
 * Receiving q base units at cost c into a balance of Q units at average A:
 *   A' = (Q·A + q·c) / (Q + q)   when Q > 0
 *   A' = c                       when Q ≤ 0 (nothing on hand to average with)
 * Stock going out leaves the average unchanged.
 */
export function averageAfterReceipt(
  balance: { quantity: string; averageCost: string },
  received: { quantity: string; unitCost: string },
): string {
  const Q = toScaled(balance.quantity, QUANTITY_SCALE);
  const A = toScaled(balance.averageCost, COST_SCALE);
  const q = toScaled(received.quantity, QUANTITY_SCALE);
  const c = toScaled(received.unitCost, COST_SCALE);
  if (q <= 0n) throw new Error('A receipt must add stock');
  if (Q <= 0n) return fromScaled(c, COST_SCALE);
  // Numerator at scale 3 + 4 = 7; dividing by a scale-3 quantity gives scale 4.
  return fromScaled(divRoundHalfUp(Q * A + q * c, Q + q), COST_SCALE);
}

/**
 * Undoes a receipt when a purchase is cancelled: q base units that came in
 * at cost c leave a balance of Q units at average A.
 *   A' = (Q·A − q·c) / (Q − q)   when Q − q > 0
 *   A' = A                       when nothing is left (no stock to value)
 * Never below zero: if later costs make the result negative (the goods
 * were partly sold at a lower average), the average becomes 0.
 */
export function averageAfterRemoval(
  balance: { quantity: string; averageCost: string },
  removed: { quantity: string; unitCost: string },
): string {
  const Q = toScaled(balance.quantity, QUANTITY_SCALE);
  const A = toScaled(balance.averageCost, COST_SCALE);
  const q = toScaled(removed.quantity, QUANTITY_SCALE);
  const c = toScaled(removed.unitCost, COST_SCALE);
  if (q <= 0n) throw new Error('A removal must take stock out');
  const left = Q - q;
  if (left <= 0n) return fromScaled(A, COST_SCALE);
  const value = divRoundHalfUp(Q * A - q * c, left);
  return fromScaled(value < 0n ? 0n : value, COST_SCALE);
}

/**
 * Cost per base unit from a cost entered for one of a unit (one carton at
 * 21,600 with 12 pieces → 1,800.0000 per piece), rounded half-up at 4 decimals.
 */
export function costPerBaseUnit(unitCost: string, conversion: string): string {
  const cost = toScaled(unitCost, COST_SCALE + QUANTITY_SCALE);
  const conv = toScaled(conversion, QUANTITY_SCALE);
  return fromScaled(divRoundHalfUp(cost, conv), COST_SCALE);
}
