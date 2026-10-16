import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { MailService } from '../../backend/src/mail/mail.service.js';
import { RemindersService } from '../../backend/src/modules/subscriptions/services/reminders.service.js';
import { createTestApp } from './helpers/app.js';
import {
  CSRF,
  drainOutbox,
  ownerWithShop,
  resetDatabase,
  resetRateLimits,
  signedInUser,
  uniqueEmail,
} from './helpers/auth.js';
import {
  DAY,
  insertPlan,
  key,
  makePaid,
  makeRestricted,
  platformAdmin,
  setSubscription,
} from './helpers/billing.js';
import { invite, joinWithRoles, roleId } from './helpers/team.js';

type Agent = Awaited<ReturnType<typeof signedInUser>>['agent'];

const near = (iso: string | null, expected: Date, toleranceMs = 60_000) => {
  expect(iso).not.toBeNull();
  expect(Math.abs(new Date(iso!).getTime() - expected.getTime())).toBeLessThan(
    toleranceMs,
  );
};

/** Plans, subscription status, manual payments, read-only mode and reminders. */
describe('Subscriptions (Phase 04)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;

  const subscription = async (agent: Agent) =>
    (await agent.get('/api/v1/shops/current/subscription').expect(200)).body;

  const pay = (agent: Agent, planId: string, reference: string, idem = key()) =>
    agent
      .post('/api/v1/shops/current/subscription/payments')
      .send({ planId, reference, idempotencyKey: idem });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    admin = (await platformAdmin(app)).agent;
  });
  afterAll(() => app.close());
  beforeEach(() => resetRateLimits(app));

  describe('trial', () => {
    it('starts a 14-day trial with every feature when a shop is created', async () => {
      const owner = await ownerWithShop(app, 'trial');
      const sub = await subscription(owner.agent);
      expect(sub.status).toBe('TRIALING');
      expect(sub.readOnly).toBe(false);
      near(sub.trialEndsAt, new Date(Date.now() + 14 * DAY));
      expect(sub.paidUntil).toBeNull();
      expect(sub.plan).toBeNull();
      expect(sub.features.seats).toEqual({ enabled: true, limit: null });
      expect(sub.features.offline_sales.enabled).toBe(true);
      expect(sub.methods).toEqual(['manual']);

      const session = await owner.agent.get('/api/v1/auth/session').expect(200);
      expect(session.body.subscription).toMatchObject({
        status: 'TRIALING',
        readOnly: false,
      });
      expect(session.body.user.isPlatformAdmin).toBe(false);

      const audit = await prisma.auditLog.findFirst({
        where: { shopId: owner.shopId, action: 'subscription.started' },
      });
      expect(audit).not.toBeNull();
    });

    it('uses the trial length from billing settings', async () => {
      await admin
        .put('/api/v1/platform/billing-settings')
        .send({
          trialDays: 7,
          reminderDaysBefore: 3,
          paymentInstructions: null,
        })
        .expect(200);
      const owner = await ownerWithShop(app, 'trial7');
      near(
        (await subscription(owner.agent)).trialEndsAt,
        new Date(Date.now() + 7 * DAY),
      );
      await admin
        .put('/api/v1/platform/billing-settings')
        .send({
          trialDays: 14,
          reminderDaysBefore: 3,
          paymentInstructions: null,
        })
        .expect(200);
    });
  });

  describe('platform access', () => {
    const platformRoutes: [string, string][] = [
      ['get', '/api/v1/platform/plans'],
      ['post', '/api/v1/platform/plans'],
      ['patch', '/api/v1/platform/plans/00000000-0000-7000-8000-000000000000'],
      ['get', '/api/v1/platform/billing-settings'],
      ['put', '/api/v1/platform/billing-settings'],
      ['get', '/api/v1/platform/payments'],
      [
        'post',
        '/api/v1/platform/payments/00000000-0000-7000-8000-000000000000/confirm',
      ],
      [
        'post',
        '/api/v1/platform/payments/00000000-0000-7000-8000-000000000000/reject',
      ],
      [
        'post',
        '/api/v1/platform/payments/00000000-0000-7000-8000-000000000000/reverse',
      ],
      ['post', '/api/v1/platform/payments/reconcile'],
    ];

    it('refuses every platform route to a shop owner who is not platform staff', async () => {
      const owner = await ownerWithShop(app, 'notplatform');
      for (const [method, url] of platformRoutes) {
        const res = await (
          owner.agent as unknown as Record<string, (u: string) => request.Test>
        )[method]!(url).send({});
        expect({ url, status: res.status, code: res.body.code }).toEqual({
          url,
          status: 403,
          code: 'platform_admin_required',
        });
      }
    });

    it('takes platform access away as soon as the flag is removed', async () => {
      const temp = await platformAdmin(app, 'tempadmin');
      await temp.agent.get('/api/v1/platform/plans').expect(200);
      await prisma.user.update({
        where: { id: temp.userId },
        data: { isPlatformAdmin: false },
      });
      await temp.agent.get('/api/v1/platform/plans').expect(403);
    });

    it('shows the platform flag in the session', async () => {
      const session = await admin.get('/api/v1/auth/session').expect(200);
      expect(session.body.user.isPlatformAdmin).toBe(true);
      expect(session.body.subscription).toBeNull();
    });
  });

  describe('plans', () => {
    const plan = (code: string) => ({
      code,
      name: 'Monthly test',
      interval: 'MONTH',
      price: '12500.50',
      graceDays: 3,
      features: [
        { featureKey: 'seats', enabled: true, limitValue: 3 },
        { featureKey: 'export', enabled: true, limitValue: null },
      ],
    });

    it('lets platform staff create and edit plans, with validation', async () => {
      const created = await admin
        .post('/api/v1/platform/plans')
        .send(plan('monthly-x'))
        .expect(201);
      expect(created.body).toMatchObject({
        code: 'monthly-x',
        interval: 'MONTH',
        price: '12500.50',
        currency: 'TZS',
        active: true,
      });
      expect(
        (
          await admin
            .post('/api/v1/platform/plans')
            .send(plan('monthly-x'))
            .expect(409)
        ).body.code,
      ).toBe('plan_code_taken');
      await admin
        .post('/api/v1/platform/plans')
        .send({ ...plan('neg'), price: '-5' })
        .expect(400);
      await admin
        .post('/api/v1/platform/plans')
        .send({ ...plan('dp'), price: '1.005' })
        .expect(400);
      await admin
        .post('/api/v1/platform/plans')
        .send({
          ...plan('bad-feature'),
          features: [{ featureKey: 'tax', enabled: true, limitValue: null }],
        })
        .expect(400);
      const dup = await admin
        .post('/api/v1/platform/plans')
        .send({
          ...plan('dup-feature'),
          features: [
            { featureKey: 'seats', enabled: true, limitValue: 1 },
            { featureKey: 'seats', enabled: true, limitValue: 2 },
          ],
        })
        .expect(400);
      expect(dup.body.code).toBe('duplicate_feature');

      const updated = await admin
        .patch(`/api/v1/platform/plans/${created.body.id}`)
        .send({
          price: '15000',
          features: [{ featureKey: 'seats', enabled: true, limitValue: 4 }],
        })
        .expect(200);
      expect(updated.body.price).toBe('15000.00');
      expect(updated.body.features).toEqual([
        { featureKey: 'seats', enabled: true, limitValue: 4 },
      ]);
      // Code and interval are fixed.
      await admin
        .patch(`/api/v1/platform/plans/${created.body.id}`)
        .send({ interval: 'WEEK' })
        .expect(400);

      const audit = await prisma.auditLog.findMany({
        where: { entityId: created.body.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual([
        'platform.plan_created',
        'platform.plan_updated',
      ]);
    });

    it('shows shops only active plans', async () => {
      const hidden = await insertPlan(app, { active: false });
      const owner = await ownerWithShop(app, 'planlist');
      const res = await owner.agent.get('/api/v1/plans').expect(200);
      const ids = (res.body.plans as { id: string }[]).map((p) => p.id);
      expect(ids).not.toContain(hidden);
      expect(ids.length).toBeGreaterThan(0);
      await request(app.getHttpServer()).get('/api/v1/plans').expect(401);
      expect(
        (await pay(owner.agent, hidden, 'HIDDEN123').expect(404)).body.code,
      ).toBe('plan_not_found');
    });
  });

  describe('manual payments', () => {
    it('records a payment as pending without changing access, until platform staff confirm it', async () => {
      const owner = await ownerWithShop(app, 'manual');
      const planId = await insertPlan(app, { price: '20000.00', seats: 3 });
      const before = await subscription(owner.agent);

      const submitted = await pay(owner.agent, planId, ' qjk7h2l9x1 ').expect(
        201,
      );
      expect(submitted.body).toMatchObject({
        status: 'PENDING',
        amount: '20000.00',
        currency: 'TZS',
        provider: 'manual',
        reference: 'QJK7H2L9X1',
        period: null,
      });

      const pending = await subscription(owner.agent);
      expect(pending.status).toBe('TRIALING');
      expect(pending.paidUntil).toBeNull();
      expect(pending.payments).toHaveLength(1);

      // The platform queue shows it; confirming adds a month after the trial.
      const queue = await admin.get('/api/v1/platform/payments').expect(200);
      expect(queue.body.payments.map((p: { id: string }) => p.id)).toContain(
        submitted.body.id,
      );
      const confirmed = await admin
        .post(`/api/v1/platform/payments/${submitted.body.id}/confirm`)
        .send({ note: 'Seen on statement' })
        .expect(200);
      expect(confirmed.body.status).toBe('CONFIRMED');

      const after = await subscription(owner.agent);
      expect(after.status).toBe('TRIALING');
      expect(after.payments[0].period.start).toBe(before.trialEndsAt);
      const trialEnd = new Date(before.trialEndsAt);
      const expectedEnd = new Date(trialEnd);
      expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);
      expect(after.paidUntil).toBe(expectedEnd.toISOString());
      expect(after.plan.id).toBe(planId);
      expect(after.features.seats.limit).toBeNull(); // still the trial

      // Deciding twice is refused.
      expect(
        (
          await admin
            .post(`/api/v1/platform/payments/${submitted.body.id}/confirm`)
            .send({})
            .expect(409)
        ).body.code,
      ).toBe('payment_already_decided');
      await admin
        .post(`/api/v1/platform/payments/${submitted.body.id}/reject`)
        .send({})
        .expect(409);

      await drainOutbox(app);
      const mail = app
        .get(MailService)
        .sent.filter((m) => m.to === owner.email)
        .at(-1);
      expect(mail?.subject).toContain('payment confirmed');
      const audit = await prisma.auditLog.findMany({
        where: { entityId: submitted.body.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual([
        'subscription.payment_submitted',
        'subscription.payment_confirmed',
      ]);
    });

    it('extends from the current paid-until when paying again early', async () => {
      const owner = await ownerWithShop(app, 'early');
      const planId = await insertPlan(app, { interval: 'WEEK' });
      await makePaid(app, owner.shopId, planId, 3);
      const paidUntil = (await subscription(owner.agent)).paidUntil as string;
      const p = await pay(owner.agent, planId, 'EARLY0001').expect(201);
      await admin
        .post(`/api/v1/platform/payments/${p.body.id}/confirm`)
        .send({})
        .expect(200);
      const sub = await subscription(owner.agent);
      expect(sub.status).toBe('ACTIVE');
      expect(sub.paidUntil).toBe(
        new Date(new Date(paidUntil).getTime() + 7 * DAY).toISOString(),
      );
    });

    it('is idempotent per key, and refuses reused keys and references', async () => {
      const owner = await ownerWithShop(app, 'idem');
      const other = await ownerWithShop(app, 'idem-other');
      const planId = await insertPlan(app);
      const k = key();
      const first = await pay(owner.agent, planId, 'IDEM00001', k).expect(201);
      const again = await pay(owner.agent, planId, 'idem00001', k).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(
        (await pay(owner.agent, planId, 'IDEM00002', k).expect(409)).body.code,
      ).toBe('idempotency_conflict');

      // Concurrent retries of one request create one payment.
      const k2 = key();
      const results = await Promise.all(
        [1, 2, 3].map(() => pay(owner.agent, planId, 'IDEM00003', k2)),
      );
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);

      // A reference can be used once, by any shop.
      expect(
        (await pay(other.agent, planId, 'IDEM00001').expect(409)).body.code,
      ).toBe('payment_reference_used');
      expect(
        (
          await owner.agent
            .post('/api/v1/shops/current/subscription/payments')
            .send({ planId, idempotencyKey: key() })
            .expect(400)
        ).body.code,
      ).toBe('reference_required');
    });

    it('limits waiting payments and lets platform staff reject them', async () => {
      const owner = await ownerWithShop(app, 'pending');
      const planId = await insertPlan(app);
      const ids: string[] = [];
      for (const ref of ['PEND00001', 'PEND00002', 'PEND00003']) {
        ids.push((await pay(owner.agent, planId, ref).expect(201)).body.id);
      }
      expect(
        (await pay(owner.agent, planId, 'PEND00004').expect(409)).body.code,
      ).toBe('too_many_pending_payments');

      const rejected = await admin
        .post(`/api/v1/platform/payments/${ids[0]}/reject`)
        .send({ note: 'No such transaction' })
        .expect(200);
      expect(rejected.body).toMatchObject({
        status: 'FAILED',
        note: 'No such transaction',
      });
      await pay(owner.agent, planId, 'PEND00004').expect(201);
      expect((await subscription(owner.agent)).paidUntil).toBeNull();

      // A rejected payment whose money turns up later can still be confirmed.
      await admin
        .post(`/api/v1/platform/payments/${ids[0]}/confirm`)
        .send({})
        .expect(200);
      expect((await subscription(owner.agent)).paidUntil).not.toBeNull();
    });

    it('does not let the browser set a payment status', async () => {
      const owner = await ownerWithShop(app, 'browser');
      const planId = await insertPlan(app);
      const res = await owner.agent
        .post('/api/v1/shops/current/subscription/payments')
        .send({
          planId,
          reference: 'BROWSER01',
          idempotencyKey: key(),
          status: 'CONFIRMED',
        })
        .expect(400);
      expect(res.body.status).toBe(400);
      expect(
        await prisma.subscriptionPayment.count({
          where: { shopId: owner.shopId },
        }),
      ).toBe(0);
    });
  });

  describe('permissions and tenant isolation', () => {
    it('needs subscription.read to view and subscription.manage to pay', async () => {
      const owner = await ownerWithShop(app, 'subperm');
      const planId = await insertPlan(app);
      const cashier = await joinWithRoles(
        app,
        { agent: owner.agent, shopId: owner.shopId },
        'subcashier',
        [await roleId(owner.agent, 'Cashier')],
      );
      expect(
        (
          await cashier.agent
            .get('/api/v1/shops/current/subscription')
            .expect(403)
        ).body.code,
      ).toBe('permission_denied');
      await pay(cashier.agent, planId, 'CASHIER01').expect(403);

      const manager = await joinWithRoles(
        app,
        { agent: owner.agent, shopId: owner.shopId },
        'submanager',
        [await roleId(owner.agent, 'Manager')],
      );
      await manager.agent.get('/api/v1/shops/current/subscription').expect(200);
      await pay(manager.agent, planId, 'MANAGER01').expect(403);

      // Everyone sees the status banner data in their session.
      const session = await cashier.agent
        .get('/api/v1/auth/session')
        .expect(200);
      expect(session.body.subscription.status).toBe('TRIALING');
    });

    it('shows a shop only its own payments, and a reversal touches only its shop', async () => {
      const a = await ownerWithShop(app, 'tenant-a');
      const b = await ownerWithShop(app, 'tenant-b');
      const planId = await insertPlan(app);
      const pa = await pay(a.agent, planId, 'TENANTA01').expect(201);
      await pay(b.agent, planId, 'TENANTB01').expect(201);
      const viewA = await subscription(a.agent);
      expect(viewA.payments.map((p: { id: string }) => p.id)).toEqual([
        pa.body.id,
      ]);
      await admin
        .post(`/api/v1/platform/payments/${pa.body.id}/confirm`)
        .send({})
        .expect(200);
      expect((await subscription(b.agent)).paidUntil).toBeNull();
      expect((await subscription(a.agent)).paidUntil).not.toBeNull();
    });
  });

  describe('grace and read-only mode (decision D-019)', () => {
    it('keeps full access during grace, then makes the shop read-only', async () => {
      const owner = await ownerWithShop(app, 'grace');
      const planId = await insertPlan(app, { seats: 10 });
      const role = await roleId(owner.agent, 'Cashier');

      await setSubscription(app, owner.shopId, {
        trialEndsAt: new Date(Date.now() - 40 * DAY),
        paidUntil: new Date(Date.now() - DAY),
        planId,
        graceDays: 3,
      });
      const grace = await subscription(owner.agent);
      expect(grace.status).toBe('GRACE');
      near(grace.graceEndsAt, new Date(Date.now() + 2 * DAY));
      await invite(app, owner.agent, uniqueEmail('grace1'), [role]);

      await setSubscription(app, owner.shopId, {
        paidUntil: new Date(Date.now() - 4 * DAY),
      });
      const restricted = await subscription(owner.agent);
      expect(restricted).toMatchObject({
        status: 'RESTRICTED',
        readOnly: true,
      });
      const refused = await owner.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email: uniqueEmail('grace2'), roleIds: [role] })
        .expect(402);
      expect(refused.body.code).toBe('subscription_read_only');
    });

    it('lets a read-only shop read, manage existing staff and pay, but not add staff', async () => {
      const owner = await ownerWithShop(app, 'readonly');
      const role = await roleId(owner.agent, 'Cashier');
      const pendingEmail = uniqueEmail('ro-pending');
      const pending = await invite(app, owner.agent, pendingEmail, [role]);
      const member = await joinWithRoles(
        app,
        { agent: owner.agent, shopId: owner.shopId },
        'ro-member',
        [role],
      );
      await makeRestricted(app, owner.shopId);

      // Reading still works.
      await owner.agent.get('/api/v1/shops/current').expect(200);
      await owner.agent.get('/api/v1/shops/current/members').expect(200);
      await owner.agent.get('/api/v1/shops/current/invitations').expect(200);
      await owner.agent.get('/api/v1/shops/current/audit-logs').expect(200);
      const session = await owner.agent.get('/api/v1/auth/session').expect(200);
      expect(session.body.subscription).toMatchObject({
        status: 'RESTRICTED',
        readOnly: true,
      });

      // Adding staff does not: invite, resend, accept.
      await owner.agent
        .post(
          `/api/v1/shops/current/invitations/${pending.invitationId}/resend`,
        )
        .expect(402);
      const invitee = await signedInUser(app, 'ro-pending', pendingEmail);
      expect(
        (
          await invitee.agent
            .post('/api/v1/invitations/accept')
            .send({ token: pending.token })
            .expect(402)
        ).body.code,
      ).toBe('subscription_read_only');

      // Removing access is still allowed (security over billing).
      await owner.agent
        .post(
          `/api/v1/shops/current/invitations/${pending.invitationId}/revoke`,
        )
        .expect(200);
      await owner.agent
        .put(`/api/v1/shops/current/members/${member.membershipId}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(204);

      // Paying is allowed, and confirmation restores access at once,
      // starting now rather than back-dated to when the trial ended.
      const planId = await insertPlan(app);
      const p = await pay(owner.agent, planId, 'READONLY1').expect(201);
      await admin
        .post(`/api/v1/platform/payments/${p.body.id}/confirm`)
        .send({})
        .expect(200);
      const sub = await subscription(owner.agent);
      expect(sub.status).toBe('ACTIVE');
      near(sub.payments[0].period.start, new Date());
      await invite(app, owner.agent, uniqueEmail('ro-after'), [role]);
    });

    it('keeps every record when a shop becomes read-only', async () => {
      const owner = await ownerWithShop(app, 'nodelete');
      const role = await roleId(owner.agent, 'Cashier');
      await joinWithRoles(
        app,
        { agent: owner.agent, shopId: owner.shopId },
        'nodelete-m',
        [role],
      );
      const before = await prisma.shopMembership.count({
        where: { shopId: owner.shopId },
      });
      await makeRestricted(app, owner.shopId);
      await subscription(owner.agent);
      expect(
        await prisma.shopMembership.count({ where: { shopId: owner.shopId } }),
      ).toBe(before);
      expect(
        await prisma.role.count({ where: { shopId: owner.shopId } }),
      ).toBeGreaterThan(0);
    });
  });

  describe('reversal', () => {
    it('removes the reversed period, recomputes paid-until and keeps the history', async () => {
      const owner = await ownerWithShop(app, 'reverse');
      const month = await insertPlan(app, { interval: 'MONTH' });
      const week = await insertPlan(app, { interval: 'WEEK' });
      const trialEnd = new Date((await subscription(owner.agent)).trialEndsAt);

      const p1 = await pay(owner.agent, month, 'REVERSE01').expect(201);
      await admin
        .post(`/api/v1/platform/payments/${p1.body.id}/confirm`)
        .send({})
        .expect(200);
      const p2 = await pay(owner.agent, week, 'REVERSE02').expect(201);
      await admin
        .post(`/api/v1/platform/payments/${p2.body.id}/confirm`)
        .send({})
        .expect(200);

      const monthEnd = new Date(trialEnd);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      expect((await subscription(owner.agent)).paidUntil).toBe(
        new Date(monthEnd.getTime() + 7 * DAY).toISOString(),
      );

      const reversed = await admin
        .post(`/api/v1/platform/payments/${p1.body.id}/reverse`)
        .send({ note: 'Chargeback' })
        .expect(200);
      expect(reversed.body.status).toBe('REVERSED');
      const sub = await subscription(owner.agent);
      expect(sub.paidUntil).toBe(
        new Date(trialEnd.getTime() + 7 * DAY).toISOString(),
      );
      expect(sub.plan.id).toBe(week);
      const row = sub.payments.find((p: { id: string }) => p.id === p1.body.id);
      expect(row.period.reversed).toBe(true);

      await admin
        .post(`/api/v1/platform/payments/${p1.body.id}/reverse`)
        .send({})
        .expect(409);
      await admin
        .post(`/api/v1/platform/payments/${p2.body.id}/reverse`)
        .send({})
        .expect(200);
      const none = await subscription(owner.agent);
      expect(none.paidUntil).toBeNull();
      expect(none.plan).toBeNull();
      expect(
        await prisma.subscriptionPeriod.count({
          where: { shopId: owner.shopId },
        }),
      ).toBe(2);
    });

    it('does not allow paid periods to be edited or deleted', async () => {
      const owner = await ownerWithShop(app, 'append');
      const planId = await insertPlan(app);
      const p = await pay(owner.agent, planId, 'APPEND001').expect(201);
      await admin
        .post(`/api/v1/platform/payments/${p.body.id}/confirm`)
        .send({})
        .expect(200);
      const period = await prisma.subscriptionPeriod.findFirstOrThrow({
        where: { paymentId: p.body.id },
      });
      await expect(
        prisma.subscriptionPeriod.update({
          where: { id: period.id },
          data: { periodEnd: new Date(Date.now() + 365 * DAY) },
        }),
      ).rejects.toThrow(/only be marked reversed/);
      await expect(
        prisma.subscriptionPeriod.delete({ where: { id: period.id } }),
      ).rejects.toThrow(/cannot be deleted/);
    });
  });

  describe('reminders', () => {
    it('emails owners before and on the day access ends, once each', async () => {
      const owner = await ownerWithShop(app, 'remind');
      const reminders = app.get(RemindersService);
      const sent = () =>
        app.get(MailService).sent.filter((m) => m.to === owner.email);
      const before = sent().length;

      const far = await owner.agent.get('/api/v1/auth/session').expect(200);
      expect(far.body.subscription.endingSoon).toBe(false);
      await setSubscription(app, owner.shopId, {
        trialEndsAt: new Date(Date.now() + 2 * DAY),
      });
      const soon = await owner.agent.get('/api/v1/auth/session').expect(200);
      expect(soon.body.subscription.endingSoon).toBe(true);
      await reminders.run();
      await reminders.run();
      await drainOutbox(app);
      expect(sent().length).toBe(before + 1);
      expect(sent().at(-1)?.subject).toMatch(/free trial ends on/);

      await setSubscription(app, owner.shopId, {
        trialEndsAt: new Date(Date.now() - 60_000),
      });
      await reminders.run();
      await reminders.run();
      await drainOutbox(app);
      expect(sent().length).toBe(before + 2);
      expect(sent().at(-1)?.subject).toMatch(/has ended/);
      expect(sent().at(-1)?.text).toMatch(/read-only/);

      // A shop far from expiry gets nothing.
      const calm = await ownerWithShop(app, 'calm');
      await reminders.run();
      await drainOutbox(app);
      expect(
        app
          .get(MailService)
          .sent.filter(
            (m) => m.to === calm.email && /ends|ended/.test(m.subject),
          ),
      ).toEqual([]);
    });

    it('reminds a paid shop again for its next end date, mentioning grace', async () => {
      const owner = await ownerWithShop(app, 'remindpaid');
      const planId = await insertPlan(app);
      const reminders = app.get(RemindersService);
      await makePaid(app, owner.shopId, planId, 1);
      await reminders.run();
      await setSubscription(app, owner.shopId, {
        paidUntil: new Date(Date.now() - 60_000),
      });
      await reminders.run();
      await drainOutbox(app);
      const mails = app
        .get(MailService)
        .sent.filter(
          (m) => m.to === owner.email && /subscription/.test(m.subject),
        );
      expect(mails.map((m) => m.subject)).toEqual([
        expect.stringMatching(/subscription ends on/),
        expect.stringMatching(/subscription has ended/),
      ]);
      expect(mails[1]!.text).toMatch(/full access until/);
      const rows = await prisma.subscriptionReminder.count({
        where: { shopId: owner.shopId },
      });
      expect(rows).toBe(2);
    });
  });

  it('rejects a callback for the manual provider (it has none) and unknown providers', async () => {
    for (const provider of ['manual', 'sandbox', 'nope']) {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/payments/callbacks/${provider}`)
        .send({ eventId: 'x', reference: 'y', status: 'CONFIRMED' })
        .expect(404);
      expect(res.body.code).toBe('provider_not_found');
    }
    // Sandbox is off without its secret, so shops cannot pick it either.
    const owner = await ownerWithShop(app, 'nosandbox');
    const res = await owner.agent
      .post('/api/v1/shops/current/subscription/payments')
      .set(CSRF)
      .send({
        planId: await insertPlan(app),
        method: 'sandbox',
        idempotencyKey: key(),
      })
      .expect(400);
    expect(res.body.code).toBe('payment_method_unavailable');
  });
});
