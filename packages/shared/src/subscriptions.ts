import { z } from 'zod';
import { moneyStringSchema } from './money.js';

/**
 * Plans, subscription status and entitlements (Phase 04, decisions D-005,
 * D-006 and D-019). Billing status is separate from staff permissions: a
 * permission says what a person may do; an entitlement says what the shop's
 * subscription allows.
 */

/**
 * Features a plan can switch on or limit. `limit` features carry a number
 * (null = unlimited); `switch` features are on or off. Only `seats` is
 * enforced so far; later phases enforce the others where they apply.
 */
export const PLAN_FEATURES = [
  { key: 'seats', kind: 'limit' },
  { key: 'products', kind: 'limit' },
  { key: 'offline_sales', kind: 'switch' },
  { key: 'profit_reports', kind: 'switch' },
  { key: 'export', kind: 'switch' },
] as const;

export type FeatureKey = (typeof PLAN_FEATURES)[number]['key'];
export const FEATURE_KEYS = PLAN_FEATURES.map((f) => f.key) as FeatureKey[];

export const planIntervals = ['WEEK', 'MONTH'] as const;
export type PlanInterval = (typeof planIntervals)[number];

/**
 * - TRIALING: the free trial; every feature, no limits.
 * - ACTIVE: a confirmed paid period covers now.
 * - GRACE: a paid period ended less than graceDays ago; still full access.
 * - RESTRICTED: read-only. Viewing, exporting and recording customer debt
 *   payments still work; nothing is deleted, and paying restores access.
 */
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'GRACE' | 'RESTRICTED';

const DAY_MS = 86_400_000;

/**
 * Adds one billing interval. Weeks are 7 days; months are calendar months
 * in UTC, clamped to the last day (31 January + 1 month = 28/29 February).
 */
export function addInterval(from: Date, interval: PlanInterval): Date {
  if (interval === 'WEEK') return new Date(from.getTime() + 7 * DAY_MS);
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export interface SubscriptionDates {
  trialEndsAt: Date;
  paidUntil: Date | null;
  graceDays: number;
}

export interface StatusResult {
  status: SubscriptionStatus;
  /** When full access ends: the trial end or paid-until date. */
  accessEndsAt: Date;
  /** End of the grace period, when there is a paid period to be late on. */
  graceEndsAt: Date | null;
}

/**
 * The single rule for a shop's status, derived from dates and never stored,
 * so it cannot drift from the payment history. Grace applies only after a
 * paid period; an unpaid trial goes straight to RESTRICTED.
 */
export function subscriptionStatus(
  s: SubscriptionDates,
  now: Date = new Date(),
): StatusResult {
  const paidUntil = s.paidUntil;
  const graceEndsAt = paidUntil
    ? new Date(paidUntil.getTime() + s.graceDays * DAY_MS)
    : null;
  const accessEndsAt =
    paidUntil && paidUntil > s.trialEndsAt ? paidUntil : s.trialEndsAt;
  let status: SubscriptionStatus;
  if (now < s.trialEndsAt) status = 'TRIALING';
  else if (paidUntil && now < paidUntil) status = 'ACTIVE';
  else if (graceEndsAt && now < graceEndsAt) status = 'GRACE';
  else status = 'RESTRICTED';
  return { status, accessEndsAt, graceEndsAt };
}

/**
 * Where a newly confirmed period starts: after any time already paid for or
 * the trial, or now if both are over (a late payment does not back-date).
 */
export function nextPeriodStart(
  s: Pick<SubscriptionDates, 'trialEndsAt' | 'paidUntil'>,
  now: Date,
): Date {
  let start = now;
  if (s.trialEndsAt > start) start = s.trialEndsAt;
  if (s.paidUntil && s.paidUntil > start) start = s.paidUntil;
  return start;
}

/**
 * Paid-until recomputed from the periods that still count (after a
 * reversal), applying each in the order it was confirmed exactly as
 * confirmation did. Null when no period remains.
 */
export function paidUntilFromPeriods(
  trialEndsAt: Date,
  periods: readonly { confirmedAt: Date; interval: PlanInterval }[],
): Date | null {
  let paidUntil: Date | null = null;
  const ordered = [...periods].sort(
    (a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime(),
  );
  for (const p of ordered) {
    const start = nextPeriodStart({ trialEndsAt, paidUntil }, p.confirmedAt);
    paidUntil = addInterval(start, p.interval);
  }
  return paidUntil;
}

export interface FeatureEntitlement {
  enabled: boolean;
  /** For limit features: null means unlimited. */
  limit: number | null;
}

export interface Entitlements {
  status: SubscriptionStatus;
  /** True when the shop may not record new work (RESTRICTED). */
  readOnly: boolean;
  features: Record<FeatureKey, FeatureEntitlement>;
}

export interface PlanFeatureValue {
  featureKey: string;
  enabled: boolean;
  limitValue: number | null;
}

/**
 * What a shop may use. The trial has everything; a paid shop has its plan's
 * features (a feature missing from the plan is not included; a missing
 * seats row means the owner alone); a restricted shop keeps its plan's
 * features for reading but cannot record new work.
 */
export function entitlementsFor(
  status: SubscriptionStatus,
  planFeatures: readonly PlanFeatureValue[] | null,
): Entitlements {
  const features = {} as Record<FeatureKey, FeatureEntitlement>;
  for (const f of PLAN_FEATURES) {
    if (status === 'TRIALING') {
      features[f.key] = { enabled: true, limit: null };
      continue;
    }
    const row = planFeatures?.find((p) => p.featureKey === f.key);
    if (row?.enabled) {
      features[f.key] = {
        enabled: true,
        limit: f.kind === 'limit' ? row.limitValue : null,
      };
    } else {
      features[f.key] = {
        enabled: f.key === 'seats',
        limit: f.key === 'seats' ? 1 : f.kind === 'limit' ? 0 : null,
      };
    }
  }
  return { status, readOnly: status === 'RESTRICTED', features };
}

// ---- API contracts ----

export const PLAN_LIMITS = {
  codeMax: 40,
  nameMax: 80,
  graceDaysMax: 60,
  featureLimitMax: 1_000_000,
} as const;

export const planFeatureInputSchema = z.object({
  featureKey: z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]),
  enabled: z.boolean(),
  limitValue: z
    .number()
    .int()
    .min(0)
    .max(PLAN_LIMITS.featureLimitMax)
    .nullable(),
});

export const planCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9][a-z0-9_-]{1,39}$/,
      'Use lowercase letters, digits, - or _',
    ),
  name: z.string().trim().min(1).max(PLAN_LIMITS.nameMax),
  interval: z.enum(planIntervals),
  price: moneyStringSchema.refine(
    (v) => !v.startsWith('-'),
    'Must not be negative',
  ),
  graceDays: z.number().int().min(0).max(PLAN_LIMITS.graceDaysMax).default(3),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  features: z.array(planFeatureInputSchema).max(PLAN_FEATURES.length),
});
export type PlanCreateInput = z.input<typeof planCreateSchema>;

/** Code and interval are fixed once a plan exists (payments refer to them). */
export const planUpdateSchema = planCreateSchema
  .omit({ code: true, interval: true })
  .partial();
export type PlanUpdateInput = z.input<typeof planUpdateSchema>;

export const billingSettingsSchema = z.object({
  trialDays: z.number().int().min(0).max(90),
  reminderDaysBefore: z.number().int().min(0).max(30),
  paymentInstructions: z.string().trim().max(1000).nullable(),
});
export type BillingSettingsInput = z.infer<typeof billingSettingsSchema>;

export const paymentMethods = ['manual', 'sandbox'] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const PAYMENT_LIMITS = { referenceMin: 4, referenceMax: 60 } as const;

export const manualPaymentSchema = z.object({
  planId: z.uuid(),
  method: z.enum(paymentMethods).default('manual'),
  /** The mobile-money transaction id from the payer's confirmation SMS. */
  reference: z
    .string()
    .trim()
    .min(PAYMENT_LIMITS.referenceMin)
    .max(PAYMENT_LIMITS.referenceMax)
    .regex(/^[A-Za-z0-9.\-_/]+$/, 'Letters, digits and . - _ / only')
    .optional(),
  payerPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{9,16}$/, 'Enter a phone number')
    .optional(),
  idempotencyKey: z.string().min(8).max(80),
});
export type ManualPaymentInput = z.input<typeof manualPaymentSchema>;

export const paymentDecisionSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export interface PlanView {
  id: string;
  code: string;
  name: string;
  interval: PlanInterval;
  /** Decimal string (decision A-008). */
  price: string;
  currency: string;
  graceDays: number;
  active: boolean;
  sortOrder: number;
  features: {
    featureKey: FeatureKey;
    enabled: boolean;
    limitValue: number | null;
  }[];
}

export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REVERSED';

export interface PaymentView {
  id: string;
  planName: string;
  amount: string;
  currency: string;
  provider: string;
  reference: string;
  status: PaymentStatus;
  createdAt: string;
  confirmedAt: string | null;
  note: string | null;
  /** The paid time this payment added, once confirmed. */
  period: { start: string; end: string; reversed: boolean } | null;
}

export interface SubscriptionView {
  status: SubscriptionStatus;
  readOnly: boolean;
  trialEndsAt: string;
  paidUntil: string | null;
  accessEndsAt: string;
  graceEndsAt: string | null;
  plan: { id: string; name: string; interval: PlanInterval } | null;
  features: Record<FeatureKey, FeatureEntitlement>;
  paymentInstructions: string | null;
  methods: PaymentMethod[];
  payments: PaymentView[];
}

/** The part of the subscription every member of the shop sees (banners). */
export interface SubscriptionSummary {
  status: SubscriptionStatus;
  readOnly: boolean;
  accessEndsAt: string;
  /** Full access ends within the reminder window (trial or paid period). */
  endingSoon: boolean;
}

export interface PlatformPaymentView extends PaymentView {
  shopId: string;
  shopName: string;
  payerPhone: string | null;
  needsReview: boolean;
}

export interface BillingSettingsView extends BillingSettingsInput {
  updatedAt: string;
}
