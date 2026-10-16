import {
  addInterval,
  entitlementsFor,
  manualPaymentSchema,
  nextPeriodStart,
  paidUntilFromPeriods,
  planCreateSchema,
  subscriptionStatus,
} from './subscriptions.js';

const d = (iso: string) => new Date(iso);
const DAY = 86_400_000;

describe('addInterval', () => {
  it('adds 7 days for a week', () => {
    expect(addInterval(d('2026-10-16T10:00:00Z'), 'WEEK')).toEqual(
      d('2026-10-23T10:00:00Z'),
    );
  });

  it('adds a calendar month in UTC, keeping the time', () => {
    expect(addInterval(d('2026-10-16T10:00:00Z'), 'MONTH')).toEqual(
      d('2026-11-16T10:00:00Z'),
    );
    expect(addInterval(d('2026-12-20T00:00:00Z'), 'MONTH')).toEqual(
      d('2027-01-20T00:00:00Z'),
    );
  });

  it('clamps to the last day of a shorter month', () => {
    expect(addInterval(d('2027-01-31T08:00:00Z'), 'MONTH')).toEqual(
      d('2027-02-28T08:00:00Z'),
    );
    expect(addInterval(d('2028-01-31T08:00:00Z'), 'MONTH')).toEqual(
      d('2028-02-29T08:00:00Z'),
    );
  });
});

describe('subscriptionStatus', () => {
  const trialEndsAt = d('2026-10-30T00:00:00Z');

  it('is TRIALING before the trial ends', () => {
    const r = subscriptionStatus(
      { trialEndsAt, paidUntil: null, graceDays: 3 },
      d('2026-10-20T00:00:00Z'),
    );
    expect(r.status).toBe('TRIALING');
    expect(r.accessEndsAt).toEqual(trialEndsAt);
    expect(r.graceEndsAt).toBeNull();
  });

  it('goes straight to RESTRICTED when an unpaid trial ends (no grace)', () => {
    const r = subscriptionStatus(
      { trialEndsAt, paidUntil: null, graceDays: 3 },
      trialEndsAt,
    );
    expect(r.status).toBe('RESTRICTED');
  });

  it('is ACTIVE while paid, GRACE for graceDays after, then RESTRICTED', () => {
    const paidUntil = d('2026-11-30T00:00:00Z');
    const s = { trialEndsAt, paidUntil, graceDays: 3 };
    expect(subscriptionStatus(s, d('2026-11-10T00:00:00Z')).status).toBe(
      'ACTIVE',
    );
    expect(subscriptionStatus(s, paidUntil).status).toBe('GRACE');
    expect(
      subscriptionStatus(s, new Date(paidUntil.getTime() + 3 * DAY - 1)).status,
    ).toBe('GRACE');
    expect(
      subscriptionStatus(s, new Date(paidUntil.getTime() + 3 * DAY)).status,
    ).toBe('RESTRICTED');
  });

  it('stays TRIALING when the shop paid during the trial', () => {
    const r = subscriptionStatus(
      { trialEndsAt, paidUntil: d('2026-11-30T00:00:00Z'), graceDays: 3 },
      d('2026-10-20T00:00:00Z'),
    );
    expect(r.status).toBe('TRIALING');
    expect(r.accessEndsAt).toEqual(d('2026-11-30T00:00:00Z'));
  });

  it('with zero grace days restricts as soon as the period ends', () => {
    const paidUntil = d('2026-11-30T00:00:00Z');
    expect(
      subscriptionStatus({ trialEndsAt, paidUntil, graceDays: 0 }, paidUntil)
        .status,
    ).toBe('RESTRICTED');
  });
});

describe('nextPeriodStart and paidUntilFromPeriods', () => {
  const trialEndsAt = d('2026-10-30T00:00:00Z');

  it('starts after the trial when paying during it', () => {
    expect(
      nextPeriodStart(
        { trialEndsAt, paidUntil: null },
        d('2026-10-20T00:00:00Z'),
      ),
    ).toEqual(trialEndsAt);
  });

  it('extends from paid-until when paying early', () => {
    const paidUntil = d('2026-12-01T00:00:00Z');
    expect(
      nextPeriodStart({ trialEndsAt, paidUntil }, d('2026-11-25T00:00:00Z')),
    ).toEqual(paidUntil);
  });

  it('starts now when the payment arrives after expiry (no back-dating)', () => {
    const now = d('2027-01-10T00:00:00Z');
    expect(
      nextPeriodStart(
        { trialEndsAt, paidUntil: d('2026-12-01T00:00:00Z') },
        now,
      ),
    ).toEqual(now);
  });

  it('recomputes paid-until from the periods that remain', () => {
    const periods = [
      { confirmedAt: d('2026-10-20T00:00:00Z'), interval: 'MONTH' as const },
      { confirmedAt: d('2026-10-21T00:00:00Z'), interval: 'WEEK' as const },
    ];
    expect(paidUntilFromPeriods(trialEndsAt, periods)).toEqual(
      d('2026-12-07T00:00:00Z'),
    );
    // Reversing the first: the week now follows the trial directly.
    expect(paidUntilFromPeriods(trialEndsAt, periods.slice(1))).toEqual(
      d('2026-11-06T00:00:00Z'),
    );
    expect(paidUntilFromPeriods(trialEndsAt, [])).toBeNull();
  });
});

describe('entitlementsFor', () => {
  const plan = [
    { featureKey: 'seats', enabled: true, limitValue: 3 },
    { featureKey: 'export', enabled: true, limitValue: null },
    { featureKey: 'offline_sales', enabled: false, limitValue: null },
  ];

  it('gives the trial every feature without limits', () => {
    const e = entitlementsFor('TRIALING', null);
    expect(e.readOnly).toBe(false);
    expect(
      Object.values(e.features).every((f) => f.enabled && f.limit === null),
    ).toBe(true);
  });

  it('gives a paid shop exactly its plan', () => {
    const e = entitlementsFor('ACTIVE', plan);
    expect(e.features.seats).toEqual({ enabled: true, limit: 3 });
    expect(e.features.export).toEqual({ enabled: true, limit: null });
    expect(e.features.offline_sales.enabled).toBe(false);
    expect(e.features.profit_reports.enabled).toBe(false);
    expect(e.features.products).toEqual({ enabled: false, limit: 0 });
  });

  it('keeps grace identical to active', () => {
    expect(entitlementsFor('GRACE', plan)).toEqual({
      ...entitlementsFor('ACTIVE', plan),
      status: 'GRACE',
    });
  });

  it('makes a restricted shop read-only', () => {
    const e = entitlementsFor('RESTRICTED', null);
    expect(e.readOnly).toBe(true);
    expect(e.features.seats).toEqual({ enabled: true, limit: 1 });
  });
});

describe('schemas', () => {
  it('accepts a valid plan and rejects negative or unknown values', () => {
    const base = {
      code: 'monthly-basic',
      name: 'Monthly basic',
      interval: 'MONTH',
      price: '25000.00',
      features: [{ featureKey: 'seats', enabled: true, limitValue: 3 }],
    };
    expect(planCreateSchema.safeParse(base).success).toBe(true);
    expect(planCreateSchema.safeParse({ ...base, price: '-1' }).success).toBe(
      false,
    );
    expect(
      planCreateSchema.safeParse({ ...base, price: '1.234' }).success,
    ).toBe(false);
    expect(
      planCreateSchema.safeParse({
        ...base,
        features: [{ featureKey: 'tax', enabled: true, limitValue: null }],
      }).success,
    ).toBe(false);
  });

  it('validates manual payment references', () => {
    const ok = {
      planId: '0199f0a0-0000-7000-8000-000000000001',
      reference: 'QJK7H2L9X1',
      idempotencyKey: 'key-12345678',
    };
    expect(manualPaymentSchema.parse(ok).method).toBe('manual');
    expect(
      manualPaymentSchema.safeParse({ ...ok, reference: 'a b' }).success,
    ).toBe(false);
    expect(
      manualPaymentSchema.safeParse({ ...ok, reference: '<x>' }).success,
    ).toBe(false);
  });
});
