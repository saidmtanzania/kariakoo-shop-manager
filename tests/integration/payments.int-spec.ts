import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import {
  SANDBOX_SIGNATURE_HEADER,
  SandboxProvider,
  sandboxSignature,
} from '../../backend/src/modules/payments/providers/sandbox.provider.js';
import { ReconciliationService } from '../../backend/src/modules/payments/services/reconciliation.service.js';
import { createTestApp } from './helpers/app.js';
import {
  ownerWithShop,
  resetDatabase,
  resetRateLimits,
} from './helpers/auth.js';
import {
  DAY,
  insertPlan,
  key,
  platformAdmin,
  setSubscription,
} from './helpers/billing.js';

const SECRET = 'sandbox-secret-for-integration-tests';
let eventCounter = 0;

/**
 * Provider callbacks and reconciliation, through the sandbox adapter: the
 * same code path a real Tanzanian provider adapter will use.
 */
describe('Payment provider callbacks and reconciliation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp({ PAYMENT_SANDBOX_SECRET: SECRET });
    delete process.env.PAYMENT_SANDBOX_SECRET;
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(() => app.close());
  beforeEach(() => resetRateLimits(app));

  /** Sends a callback signed with `secret` (the real one by default). */
  const callback = (
    body: Record<string, unknown>,
    secret: string | null = SECRET,
  ) => {
    const raw = JSON.stringify(body);
    const req = request(app.getHttpServer())
      .post('/api/v1/payments/callbacks/sandbox')
      .set('content-type', 'application/json');
    if (secret)
      req.set(SANDBOX_SIGNATURE_HEADER, sandboxSignature(secret, raw));
    return req.send(raw);
  };

  const event = (
    reference: string,
    status: string,
    amount: string | null = '5000.00',
  ) => {
    eventCounter += 1;
    return {
      eventId: `evt-${Date.now()}-${eventCounter}`,
      reference,
      status,
      amount,
      currency: 'TZS',
    };
  };

  /** A shop with a pending sandbox payment for a 5,000 monthly test plan. */
  async function pendingPayment(label: string) {
    const owner = await ownerWithShop(app, label);
    const planId = await insertPlan(app, { price: '5000.00' });
    const res = await owner.agent
      .post('/api/v1/shops/current/subscription/payments')
      .send({ planId, method: 'sandbox', idempotencyKey: key() })
      .expect(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.reference).toBe(`SBX-${res.body.id}`);
    return {
      owner,
      planId,
      paymentId: res.body.id as string,
      reference: res.body.reference as string,
    };
  }

  const payment = (id: string) =>
    prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id },
      include: { period: true },
    });
  const subscriptionOf = (shopId: string) =>
    prisma.subscription.findUniqueOrThrow({ where: { shopId } });

  it('offers the sandbox method only when it is configured', async () => {
    const owner = await ownerWithShop(app, 'methods');
    const sub = await owner.agent
      .get('/api/v1/shops/current/subscription')
      .expect(200);
    expect(sub.body.methods).toEqual(['manual', 'sandbox']);
  });

  it('ignores unsigned or wrongly signed callbacks, but keeps them as evidence', async () => {
    const { paymentId, reference } = await pendingPayment('badsig');
    const forged = event(reference, 'CONFIRMED');
    expect((await callback(forged, null).expect(401)).body.code).toBe(
      'invalid_signature',
    );
    expect(
      (await callback(forged, 'not-the-real-secret-at-all').expect(401)).body
        .code,
    ).toBe('invalid_signature');
    // A valid signature over different bytes than were sent also fails.
    const raw = JSON.stringify(forged);
    await request(app.getHttpServer())
      .post('/api/v1/payments/callbacks/sandbox')
      .set('content-type', 'application/json')
      .set(SANDBOX_SIGNATURE_HEADER, sandboxSignature(SECRET, raw))
      .send(JSON.stringify({ ...forged, amount: '1.00' }))
      .expect(401);

    expect((await payment(paymentId)).status).toBe('PENDING');
    const stored = await prisma.paymentEvent.findMany({
      where: { provider: 'sandbox', signatureValid: false },
    });
    expect(stored.length).toBeGreaterThanOrEqual(2);
    expect(
      stored.every(
        (e) => e.outcome.startsWith('invalid:') && e.paymentId === null,
      ),
    ).toBe(true);
  });

  it('confirms on a verified callback and treats repeats as duplicates', async () => {
    const { owner, paymentId, reference } = await pendingPayment('confirm');
    const ev = event(reference, 'CONFIRMED');
    expect((await callback(ev).expect(200)).body).toEqual({
      received: true,
      outcome: 'confirmed',
    });
    // The same event again, and a new event with the same news.
    expect((await callback(ev).expect(200)).body.outcome).toBe('duplicate');
    expect(
      (await callback(event(reference, 'CONFIRMED')).expect(200)).body.outcome,
    ).toBe('duplicate');

    const p = await payment(paymentId);
    expect(p.status).toBe('CONFIRMED');
    expect(p.decidedByUserId).toBeNull();
    expect(
      await prisma.subscriptionPeriod.count({ where: { paymentId } }),
    ).toBe(1);
    expect((await subscriptionOf(owner.shopId)).paidUntil).not.toBeNull();
    const stored = await prisma.paymentEvent.findFirstOrThrow({
      where: { provider: 'sandbox', providerEventId: ev.eventId },
    });
    expect(stored).toMatchObject({
      signatureValid: true,
      outcome: 'confirmed',
      paymentId,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: paymentId, action: 'subscription.payment_confirmed' },
    });
    expect(audit.actorUserId).toBeNull();
    expect(audit.after).toMatchObject({ source: 'callback' });
  });

  it('grants one period when many callbacks arrive at once', async () => {
    const { owner, paymentId, reference } = await pendingPayment('concurrent');
    const same = event(reference, 'CONFIRMED');
    const results = await Promise.all([
      callback(same),
      callback(same),
      callback(event(reference, 'CONFIRMED')),
      callback(event(reference, 'CONFIRMED')),
      callback(event(reference, 'CONFIRMED')),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.outcome === 'confirmed')).toHaveLength(
      1,
    );
    expect(
      await prisma.subscriptionPeriod.count({ where: { paymentId } }),
    ).toBe(1);
    const sub = await subscriptionOf(owner.shopId);
    const period = (await payment(paymentId)).period!;
    expect(sub.paidUntil).toEqual(period.periodEnd);
  });

  it('flags an amount mismatch for review instead of confirming', async () => {
    const { owner, paymentId, reference } = await pendingPayment('mismatch');
    expect(
      (await callback(event(reference, 'CONFIRMED', '500.00')).expect(200)).body
        .outcome,
    ).toBe('amount_mismatch');
    expect(
      (await callback(event(reference, 'CONFIRMED', null)).expect(200)).body
        .outcome,
    ).toBe('amount_mismatch');
    const p = await payment(paymentId);
    expect(p).toMatchObject({ status: 'PENDING', needsReview: true });
    expect(p.note).toMatch(/expected/);
    expect((await subscriptionOf(owner.shopId)).paidUntil).toBeNull();

    const admin = await platformAdmin(app, 'mismatch-admin');
    const queue = await admin.agent
      .get('/api/v1/platform/payments')
      .expect(200);
    const row = queue.body.payments.find(
      (x: { id: string }) => x.id === paymentId,
    );
    expect(row).toMatchObject({ needsReview: true, shopName: 'mismatch shop' });
  });

  it('marks failed payments, and flags success that arrives after a failure', async () => {
    const { owner, paymentId, reference } = await pendingPayment('failed');
    expect(
      (await callback(event(reference, 'FAILED')).expect(200)).body.outcome,
    ).toBe('failed');
    expect(
      (await callback(event(reference, 'FAILED')).expect(200)).body.outcome,
    ).toBe('duplicate');
    expect((await payment(paymentId)).status).toBe('FAILED');

    // A delayed success after a failure is not trusted automatically.
    expect(
      (await callback(event(reference, 'CONFIRMED')).expect(200)).body.outcome,
    ).toBe('flagged');
    const p = await payment(paymentId);
    expect(p).toMatchObject({ status: 'FAILED', needsReview: true });
    expect((await subscriptionOf(owner.shopId)).paidUntil).toBeNull();
  });

  it('reverses a confirmed payment and removes its time', async () => {
    const { owner, paymentId, reference } = await pendingPayment('reversed');
    await callback(event(reference, 'CONFIRMED')).expect(200);
    expect((await subscriptionOf(owner.shopId)).paidUntil).not.toBeNull();

    expect(
      (await callback(event(reference, 'REVERSED')).expect(200)).body.outcome,
    ).toBe('reversed');
    expect(
      (await callback(event(reference, 'REVERSED')).expect(200)).body.outcome,
    ).toBe('duplicate');
    const p = await payment(paymentId);
    expect(p.status).toBe('REVERSED');
    expect(p.period?.reversedAt).not.toBeNull();
    expect((await subscriptionOf(owner.shopId)).paidUntil).toBeNull();
    // A late confirmation cannot bring a reversed payment back.
    expect(
      (await callback(event(reference, 'CONFIRMED')).expect(200)).body.outcome,
    ).toBe('ignored');
  });

  it('flags a reversal of a payment that was never confirmed', async () => {
    const { paymentId, reference } = await pendingPayment('revpending');
    expect(
      (await callback(event(reference, 'REVERSED')).expect(200)).body.outcome,
    ).toBe('flagged');
    expect(await payment(paymentId)).toMatchObject({
      status: 'PENDING',
      needsReview: true,
    });
  });

  it('starts the period now when the confirmation arrives after the subscription ended', async () => {
    const { owner, paymentId, reference } = await pendingPayment('delayed');
    await setSubscription(app, owner.shopId, {
      trialEndsAt: new Date(Date.now() - 10 * DAY),
    });
    const before = await owner.agent
      .get('/api/v1/shops/current/subscription')
      .expect(200);
    expect(before.body.status).toBe('RESTRICTED');

    await callback(event(reference, 'CONFIRMED')).expect(200);
    const period = (await payment(paymentId)).period!;
    expect(Math.abs(period.periodStart.getTime() - Date.now())).toBeLessThan(
      60_000,
    );
    const after = await owner.agent
      .get('/api/v1/shops/current/subscription')
      .expect(200);
    expect(after.body.status).toBe('ACTIVE');
  });

  it('acknowledges callbacks for unknown payments without changing anything', async () => {
    const res = await callback(event('SBX-does-not-exist', 'CONFIRMED')).expect(
      200,
    );
    expect(res.body.outcome).toBe('unknown_payment');
  });

  it('reconciles overdue pending payments by asking the provider', async () => {
    const due = await pendingPayment('recon-due');
    const fresh = await pendingPayment('recon-fresh');
    const failing = await pendingPayment('recon-fail');
    await prisma.subscriptionPayment.updateMany({
      where: { id: { in: [due.paymentId, failing.paymentId] } },
      data: { createdAt: new Date(Date.now() - 30 * 60_000) },
    });
    const sandbox = app.get(SandboxProvider);
    sandbox.settle(due.reference, 'CONFIRMED', '5000.00');
    sandbox.settle(fresh.reference, 'CONFIRMED', '5000.00');
    sandbox.settle(failing.reference, 'FAILED', null);

    const result = await app.get(ReconciliationService).run();
    expect(result.changed).toBe(2);
    expect((await payment(due.paymentId)).status).toBe('CONFIRMED');
    expect((await payment(failing.paymentId)).status).toBe('FAILED');
    // Not overdue yet: left for its callback.
    expect((await payment(fresh.paymentId)).status).toBe('PENDING');

    // Running again changes nothing, and a late callback is a duplicate.
    expect((await app.get(ReconciliationService).run()).changed).toBe(0);
    expect(
      (await callback(event(due.reference, 'CONFIRMED')).expect(200)).body
        .outcome,
    ).toBe('duplicate');
    expect(
      await prisma.subscriptionPeriod.count({
        where: { paymentId: due.paymentId },
      }),
    ).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityId: due.paymentId,
        action: 'subscription.payment_confirmed',
      },
    });
    expect(audit.after).toMatchObject({ source: 'reconciliation' });
  });

  it('leaves manual payments to platform staff (no provider to ask)', async () => {
    const owner = await ownerWithShop(app, 'recon-manual');
    const planId = await insertPlan(app);
    const res = await owner.agent
      .post('/api/v1/shops/current/subscription/payments')
      .send({ planId, reference: 'MANUALREC1', idempotencyKey: key() })
      .expect(201);
    await prisma.subscriptionPayment.update({
      where: { id: res.body.id },
      data: { createdAt: new Date(Date.now() - 2 * DAY) },
    });
    await app.get(ReconciliationService).run();
    expect((await payment(res.body.id)).status).toBe('PENDING');
  });
});
