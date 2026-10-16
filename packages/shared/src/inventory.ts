import { z } from 'zod';
import { DecimalError, fromScaled, toScaled } from './decimal.js';

/**
 * Products, units and stock (Phase 05). Decisions:
 * - D-013: quantities have at most 3 decimals, and only in units that allow
 *   fractions (kg, metre); other units take whole numbers.
 * - D-021: prices are whole Tanzanian shillings (stored as numeric(18,2)).
 * - D-007: stock may not go below zero unless the owner allows it for sales.
 * - D-003: weighted-average cost per base unit, 4 decimals.
 */

export const QUANTITY_SCALE = 3;
export const COST_SCALE = 4;

export const PRODUCT_LIMITS = {
  nameMax: 160,
  skuMax: 40,
  unitNameMax: 40,
  barcodeMax: 64,
  categoryNameMax: 60,
  noteMax: 500,
  unitsMax: 10,
  pageMax: 100,
  /** Largest quantity or conversion accepted (fits numeric(18,3)). */
  quantityMax: '999999999999',
} as const;

/** Whole shillings: "24000" (a trailing ".00" from the API is accepted). */
export const priceStringSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.0{1,2})?$/, 'Enter a whole amount in shillings');

/** A positive quantity with at most 3 decimals. */
export const positiveQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Enter a number with at most 3 decimals')
  .refine((v) => /[1-9]/.test(v), 'Must be more than zero');

/** A quantity that may be zero (a stock count, a reorder level). */
export const nonNegativeQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Enter a number with at most 3 decimals');

export type QuantityProblem =
  'fraction_not_allowed' | 'base_fraction_not_allowed';

export class QuantityError extends Error {
  constructor(readonly code: QuantityProblem) {
    super(code);
    this.name = 'QuantityError';
  }
}

/** True when the decimal string has no fractional part. */
export function isWhole(value: string): boolean {
  return toScaled(value, QUANTITY_SCALE) % 10n ** BigInt(QUANTITY_SCALE) === 0n;
}

/**
 * Converts a quantity entered in a unit to base units (one carton of 12
 * pieces → 12). Checks the unit's fraction rule and that the result fits
 * the base unit: a whole-only base unit cannot hold 1.2 pieces.
 */
export function toBaseQuantity(
  quantity: string,
  unit: { conversion: string; allowFraction: boolean },
  baseAllowsFraction: boolean,
): string {
  if (!unit.allowFraction && !isWhole(quantity)) {
    throw new QuantityError('fraction_not_allowed');
  }
  const scale = BigInt(QUANTITY_SCALE);
  const product =
    toScaled(quantity, QUANTITY_SCALE) *
    toScaled(unit.conversion, QUANTITY_SCALE);
  // product is at scale 6; it must be exact at scale 3.
  if (product % 10n ** scale !== 0n) {
    throw new QuantityError('base_fraction_not_allowed');
  }
  const base = product / 10n ** scale;
  if (!baseAllowsFraction && base % 10n ** scale !== 0n) {
    throw new QuantityError('base_fraction_not_allowed');
  }
  return fromScaled(base, QUANTITY_SCALE);
}

/**
 * Checks a new unit's conversion against the base unit: a base unit that
 * takes whole numbers needs whole conversions, so whole quantities of the
 * unit always land on whole base quantities.
 */
export function conversionFits(
  conversion: string,
  baseAllowsFraction: boolean,
): boolean {
  try {
    const scaled = toScaled(conversion, QUANTITY_SCALE);
    if (scaled <= 0n) return false;
    return baseAllowsFraction || scaled % 10n ** BigInt(QUANTITY_SCALE) === 0n;
  } catch (err) {
    if (err instanceof DecimalError) return false;
    throw err;
  }
}

// ---- API contracts ----

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const unitPricesSchema = z.object({
  buyingPrice: priceStringSchema.nullable().optional(),
  retailPrice: priceStringSchema.nullable().optional(),
  wholesalePrice: priceStringSchema.nullable().optional(),
});
export type UnitPricesInput = z.input<typeof unitPricesSchema>;

export const baseUnitInputSchema = unitPricesSchema.extend({
  name: z.string().trim().min(1).max(PRODUCT_LIMITS.unitNameMax),
  allowFraction: z.boolean().default(false),
  barcode: optionalText(PRODUCT_LIMITS.barcodeMax),
});

export const unitInputSchema = baseUnitInputSchema.extend({
  /** Base units in one of this unit (carton = 12 pieces → "12"). */
  conversion: positiveQuantitySchema,
});
export type UnitInput = z.input<typeof unitInputSchema>;

export const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(PRODUCT_LIMITS.nameMax),
  categoryId: z.uuid().nullable().optional(),
  sku: optionalText(PRODUCT_LIMITS.skuMax),
  reorderLevel: nonNegativeQuantitySchema.nullable().optional(),
  baseUnit: baseUnitInputSchema,
  units: z
    .array(unitInputSchema)
    .max(PRODUCT_LIMITS.unitsMax - 1)
    .default([]),
  /** Optional opening stock, in any of the units above (by name). */
  openingStock: z
    .object({
      unitName: z.string().trim().min(1).max(PRODUCT_LIMITS.unitNameMax),
      quantity: positiveQuantitySchema,
      /** Cost of one of that unit, whole shillings. */
      unitCost: priceStringSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type ProductCreateInput = z.input<typeof productCreateSchema>;

export const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(PRODUCT_LIMITS.nameMax).optional(),
  categoryId: z.uuid().nullable().optional(),
  sku: optionalText(PRODUCT_LIMITS.skuMax),
  reorderLevel: nonNegativeQuantitySchema.nullable().optional(),
});
export type ProductUpdateInput = z.input<typeof productUpdateSchema>;

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(PRODUCT_LIMITS.categoryNameMax),
});

export const adjustmentKinds = ['add', 'remove', 'count'] as const;
export type AdjustmentKind = (typeof adjustmentKinds)[number];

export const adjustmentReasons = [
  'COUNT_CORRECTION',
  'DAMAGED',
  'EXPIRED',
  'LOST',
  'FOUND',
  'OWN_USE',
  'OTHER',
] as const;
export type AdjustmentReason = (typeof adjustmentReasons)[number];

export const adjustmentSchema = z
  .object({
    productId: z.uuid(),
    unitId: z.uuid(),
    /** add or remove this quantity, or set the counted quantity. */
    kind: z.enum(adjustmentKinds),
    quantity: nonNegativeQuantitySchema,
    reason: z.enum(adjustmentReasons),
    note: optionalText(PRODUCT_LIMITS.noteMax),
    /** Cost of one of the unit for stock added; defaults to the average cost. */
    unitCost: priceStringSchema.nullable().optional(),
    idempotencyKey: z.string().min(8).max(80),
  })
  .refine((v) => v.kind === 'count' || /[1-9]/.test(v.quantity), {
    message: 'Must be more than zero',
    path: ['quantity'],
  })
  .refine((v) => v.reason !== 'OTHER' || !!v.note, {
    message: 'Explain the reason',
    path: ['note'],
  });
export type AdjustmentInput = z.input<typeof adjustmentSchema>;

export const openingStockSchema = z.object({
  unitId: z.uuid(),
  quantity: positiveQuantitySchema,
  unitCost: priceStringSchema.nullable().optional(),
});
export type OpeningStockInput = z.input<typeof openingStockSchema>;

export const stockFilters = ['low', 'out', 'negative'] as const;
export type StockFilter = (typeof stockFilters)[number];

export interface CategoryView {
  id: string;
  name: string;
  archived: boolean;
  productCount: number;
}

export interface UnitView {
  id: string;
  name: string;
  /** Base units in one of this unit. */
  conversion: string;
  isBase: boolean;
  allowFraction: boolean;
  barcode: string | null;
  /** Null when not set, or hidden from people who cannot see costs. */
  buyingPrice: string | null;
  retailPrice: string | null;
  wholesalePrice: string | null;
  archived: boolean;
}

/** A row in the product list and search results. */
export interface ProductListItem {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  baseUnit: { id: string; name: string; allowFraction: boolean };
  retailPrice: string | null;
  wholesalePrice: string | null;
  /** Base quantity; null for people without inventory.read. */
  quantity: string | null;
  reorderLevel: string | null;
  lowStock: boolean;
  archived: boolean;
  /** The unit whose barcode matched the search, if any. */
  matchedUnitId: string | null;
}

export interface ProductDetail {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  reorderLevel: string | null;
  archived: boolean;
  units: UnitView[];
  stock: {
    /** Null for people without inventory.read. */
    quantity: string | null;
    /** Weighted-average cost per base unit; null unless costs are visible. */
    averageCost: string | null;
    lowStock: boolean;
    hasMovements: boolean;
  };
  /** Whether this viewer may see buying prices and costs. */
  canSeeCosts: boolean;
  createdAt: string;
}

export type StockMovementType =
  | 'OPENING'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'PURCHASE_RECEIPT'
  | 'PURCHASE_REVERSAL';

export interface StockMovementView {
  id: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  /** Signed base quantity. */
  quantity: string;
  balanceAfter: string;
  unitName: string;
  unitQuantity: string;
  conversion: string;
  /** Per base unit; null unless costs are visible. */
  unitCost: string | null;
  reason: AdjustmentReason | null;
  /** The purchase that received or reversed this stock. */
  purchaseId: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface InventorySummary {
  productCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  negativeCount: number;
  allowNegativeStock: boolean;
}

export interface ReconciliationResult {
  checkedProducts: number;
  /** Products whose balance differs from the sum of their movements. */
  mismatches: {
    productId: string;
    productName: string;
    balance: string;
    ledgerTotal: string;
  }[];
}
