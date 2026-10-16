import { z } from 'zod';
import { divRoundHalfUp, fromScaled, toScaled } from './decimal.js';
import {
  COST_SCALE,
  positiveQuantitySchema,
  priceStringSchema,
  QUANTITY_SCALE,
} from './inventory.js';

/**
 * Suppliers and purchases (Phase 06). Decisions:
 * - D-014: no purchase orders; a purchase is a draft until the goods arrive,
 *   then it is received as it actually arrived (no partial receiving).
 * - D-015: extra costs on a purchase (transport, porters) are spread over
 *   its lines by value and included in the cost of the goods.
 * - D-021: amounts are whole shillings; line totals round half-up.
 * - D-003: received goods update the weighted-average cost.
 */

export const PURCHASE_LIMITS = {
  supplierNameMax: 120,
  phoneMax: 30,
  addressMax: 200,
  noteMax: 500,
  referenceMax: 60,
  chargeDescriptionMax: 80,
  linesMax: 100,
  chargesMax: 10,
  pageMax: 100,
} as const;

export const purchaseStatuses = ['DRAFT', 'RECEIVED', 'CANCELLED'] as const;
export type PurchaseStatus = (typeof purchaseStatuses)[number];

export const supplierPaymentMethods = [
  'CASH',
  'MOBILE_MONEY',
  'BANK',
  'OTHER',
] as const;
export type SupplierPaymentMethod = (typeof supplierPaymentMethods)[number];

export const supplierEntryTypes = [
  'OPENING_BALANCE',
  'PURCHASE',
  'PURCHASE_CANCELLED',
  'PAYMENT',
  'PAYMENT_REVERSED',
] as const;
export type SupplierEntryType = (typeof supplierEntryTypes)[number];

const SHILLINGS = 0;

/** A positive whole-shilling amount. */
export const positiveAmountSchema = priceStringSchema.refine(
  (v) => /[1-9]/.test(v),
  'Must be more than zero',
);

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(PURCHASE_LIMITS.supplierNameMax),
  phone: optionalText(PURCHASE_LIMITS.phoneMax),
  address: optionalText(PURCHASE_LIMITS.addressMax),
  note: optionalText(PURCHASE_LIMITS.noteMax),
  /** What the shop already owes this supplier when it is added. */
  openingBalance: priceStringSchema.nullable().optional(),
});
export type SupplierInput = z.input<typeof supplierSchema>;

export const purchaseLineSchema = z.object({
  productId: z.uuid(),
  unitId: z.uuid(),
  quantity: positiveQuantitySchema,
  /** Cost of one of the unit, whole shillings. */
  unitCost: priceStringSchema,
});

export const purchaseChargeSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .max(PURCHASE_LIMITS.chargeDescriptionMax),
  amount: positiveAmountSchema,
});

export const purchaseSchema = z.object({
  supplierId: z.uuid(),
  supplierReference: optionalText(PURCHASE_LIMITS.referenceMax),
  note: optionalText(PURCHASE_LIMITS.noteMax),
  lines: z.array(purchaseLineSchema).min(1).max(PURCHASE_LIMITS.linesMax),
  charges: z.array(purchaseChargeSchema).max(PURCHASE_LIMITS.chargesMax),
});
export type PurchaseInput = z.input<typeof purchaseSchema>;

export const supplierPaymentSchema = z.object({
  amount: positiveAmountSchema,
  method: z.enum(supplierPaymentMethods),
  reference: optionalText(PURCHASE_LIMITS.referenceMax),
  note: optionalText(PURCHASE_LIMITS.noteMax),
});
export type SupplierPaymentInput = z.input<typeof supplierPaymentSchema>;

export class PurchaseRuleError extends Error {
  constructor(readonly code: 'charges_need_value') {
    super(code);
    this.name = 'PurchaseRuleError';
  }
}

/**
 * Quantity × cost of one unit, rounded half-up to whole shillings (D-021):
 * 1.5 kg at 1,999 = 2,998.5 → 2,999.
 */
export function lineTotal(quantity: string, unitCost: string): string {
  const q = toScaled(quantity, QUANTITY_SCALE);
  const c = toScaled(unitCost, SHILLINGS);
  return fromScaled(
    divRoundHalfUp(q * c, 10n ** BigInt(QUANTITY_SCALE)),
    SHILLINGS,
  );
}

/** Sum of whole-shilling amounts. */
export function sumAmounts(amounts: string[]): string {
  return fromScaled(
    amounts.reduce((sum, a) => sum + toScaled(a, SHILLINGS), 0n),
    SHILLINGS,
  );
}

/**
 * Spreads extra costs over lines in proportion to their value (D-015), in
 * whole shillings, so the shares always add up to the extra exactly. Each
 * line first gets the rounded-down share; the shillings left over go to the
 * lines with the largest remainders (earlier lines first on a tie).
 */
export function allocateCharges(lineTotals: string[], extra: string): string[] {
  const values = lineTotals.map((v) => toScaled(v, SHILLINGS));
  const total = values.reduce((a, b) => a + b, 0n);
  const charge = toScaled(extra, SHILLINGS);
  if (charge === 0n) return values.map(() => '0');
  if (total === 0n) throw new PurchaseRuleError('charges_need_value');
  const shares = values.map((v) => (v * charge) / total);
  const remainders = values.map((v, i) => ({
    i,
    r: v * charge - shares[i]! * total,
  }));
  let left = charge - shares.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    shares[i]! += 1n;
    left -= 1n;
  }
  return shares.map((s) => fromScaled(s, SHILLINGS));
}

/**
 * Cost of one base unit including its share of extra costs, 4 decimals,
 * half-up: 2 cartons of 12 at 21,600 plus 1,200 transport → 1,850.0000.
 */
export function landedCostPerBase(
  lineValue: string,
  allocatedExtra: string,
  baseQuantity: string,
): string {
  const value =
    toScaled(lineValue, SHILLINGS) + toScaled(allocatedExtra, SHILLINGS);
  const base = toScaled(baseQuantity, QUANTITY_SCALE);
  // value × 10^(4+3) / base(scale 3) gives scale 4.
  return fromScaled(
    divRoundHalfUp(value * 10n ** BigInt(COST_SCALE + QUANTITY_SCALE), base),
    COST_SCALE,
  );
}

export interface SupplierView {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  note: string | null;
  /**
   * What the shop owes the supplier; negative when the supplier owes the
   * shop. Null for people who cannot see costs (A-030).
   */
  balance: string | null;
  archived: boolean;
  createdAt: string;
}

export interface SupplierEntryView {
  id: string;
  type: SupplierEntryType;
  /** Positive increases what the shop owes; negative reduces it. */
  amount: string | null;
  balanceAfter: string | null;
  purchaseId: string | null;
  purchaseNumber: number | null;
  paymentId: string | null;
  /** For a payment: whether it was later reversed. */
  paymentReversed: boolean;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface SupplierPaymentView {
  id: string;
  supplierId: string;
  amount: string | null;
  method: SupplierPaymentMethod;
  reference: string | null;
  note: string | null;
  purchaseId: string | null;
  reversed: boolean;
  reverseReason: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface PurchaseLineView {
  id: string;
  productId: string;
  productName: string;
  unitId: string;
  unitName: string;
  conversion: string;
  quantity: string;
  baseQuantity: string;
  /** Money fields on purchases are null for people who cannot see costs (A-030). */
  unitCost: string | null;
  lineTotal: string | null;
  /** Share of extra costs; set when received. */
  allocatedExtra: string | null;
  /** Cost per base unit including extra costs; set when received. */
  landedCostPerBase: string | null;
}

export interface PurchaseChargeView {
  id: string;
  description: string;
  amount: string | null;
}

export interface PurchaseListItem {
  id: string;
  number: number;
  status: PurchaseStatus;
  supplierId: string;
  supplierName: string;
  supplierReference: string | null;
  total: string | null;
  lineCount: number;
  createdAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
}

export interface PurchaseDetail extends PurchaseListItem {
  note: string | null;
  subtotal: string | null;
  extraCosts: string | null;
  lines: PurchaseLineView[];
  charges: PurchaseChargeView[];
  /** Payments recorded with this purchase. */
  payments: SupplierPaymentView[];
  createdByName: string | null;
  receivedByName: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
}

export interface SupplierReconciliation {
  checkedSuppliers: number;
  /** Suppliers whose stored balance differs from the sum of their ledger. */
  mismatches: {
    supplierId: string;
    supplierName: string;
    balance: string;
    ledgerTotal: string;
  }[];
}
