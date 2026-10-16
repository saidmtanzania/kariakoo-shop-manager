import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hashToken } from '../../backend/src/common/crypto/tokens.js';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { MAX_RESENDS } from '../../backend/src/modules/invitations/services/invitations.service.js';
import { createTestApp } from './helpers/app.js';
import { insertPlan, makePaid } from './helpers/billing.js';
import {
  client,
  CSRF,
  drainOutbox,
  lastMailTo,
  ownerWithShop,
  resetDatabase,
  signedInUser,
  uniqueEmail,
} from './helpers/auth.js';
import { createRole, invite, joinWithRoles, roleId } from './helpers/team.js';

/**
 * Staff invitations (WF-03): hashed single-use tokens, 7-day expiry,
 * revocation, resending, the email must match, and seat limits.
 */
describe('Invitations (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: Awaited<ReturnType<typeof ownerWithShop>>;
  let cashierRole: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    owner = await ownerWithShop(app, 'owner', 'Owner Traders');
    cashierRole = await roleId(owner.agent, 'Cashier');
  });
  afterAll(() => app.close());

  const expire = (id: string) =>
    prisma.invitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

  const accept = (agent: ReturnType<typeof client>, token: string) =>
    agent.post('/api/v1/invitations/accept').send({ token });

  describe('lifecycle', () => {
    it('invite, preview, accept: the new member gets the roles and the shop becomes active', async () => {
      const email = uniqueEmail('staff');
      const { invitationId, token } = await invite(app, owner.agent, email, [
        cashierRole,
      ]);

      const stored = await prisma.invitation.findUniqueOrThrow({
        where: { id: invitationId },
      });
      expect(stored.tokenHash).toBe(hashToken(token));
      expect(stored.tokenHash).not.toContain(token);
      const days = (stored.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThanOrEqual(7);

      const preview = await request(app.getHttpServer())
        .post('/api/v1/invitations/preview')
        .set(CSRF)
        .send({ token })
        .expect(200);
      expect(preview.body).toMatchObject({
        shopName: 'Owner Traders',
        email,
        status: 'PENDING',
        invitedBy: 'owner Tester',
      });

      const staff = await signedInUser(app, 'staff', email);
      const res = await accept(staff.agent, token).expect(200);
      expect(res.body.shopId).toBe(owner.shopId);

      const session = await staff.agent.get('/api/v1/auth/session').expect(200);
      expect(session.body.activeShopId).toBe(owner.shopId);
      expect(session.body.permissions).toContain('sales.create');
      const members = (
        await owner.agent.get('/api/v1/shops/current/members').expect(200)
      ).body.members;
      const row = members.find((m: { email: string }) => m.email === email);
      expect(row).toMatchObject({
        isOwner: false,
        status: 'ACTIVE',
        roles: [{ id: cashierRole, name: 'Cashier' }],
      });

      const list = (
        await owner.agent.get('/api/v1/shops/current/invitations').expect(200)
      ).body.invitations;
      expect(list[0]).toMatchObject({ id: invitationId, status: 'ACCEPTED' });
    });

    it('a token works once', async () => {
      const email = uniqueEmail('once');
      const { token } = await invite(app, owner.agent, email, [cashierRole]);
      const staff = await signedInUser(app, 'once', email);
      await accept(staff.agent, token).expect(200);
      const again = await accept(staff.agent, token).expect(409);
      expect(again.body.code).toBe('invitation_used');
    });

    it('two simultaneous accepts create one membership', async () => {
      const email = uniqueEmail('race');
      const { token } = await invite(app, owner.agent, email, [cashierRole]);
      const staff = await signedInUser(app, 'race', email);
      const results = await Promise.all([
        accept(staff.agent, token),
        accept(staff.agent, token),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.shopMembership.count({
          where: { shopId: owner.shopId, userId: staff.userId },
        }),
      ).toBe(1);
    });

    it('the queued email keeps the link only until it is sent', async () => {
      const email = uniqueEmail('outbox');
      await owner.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email, roleIds: [cashierRole] })
        .expect(201);
      const queued = await prisma.outboxMessage.findFirstOrThrow({
        where: { shopId: owner.shopId },
      });
      expect(queued.status).toBe('PENDING');
      expect(JSON.stringify(queued.payload)).toContain('#token=');

      await drainOutbox(app);
      const sent = await prisma.outboxMessage.findUniqueOrThrow({
        where: { id: queued.id },
      });
      expect(sent.status).toBe('DONE');
      expect(sent.payload).toEqual({ to: email, subject: expect.any(String) });
      const { mail } = await lastMailTo(app, email);
      expect(mail?.subject).toContain('Owner Traders');
    });

    it('an unknown token is not found and reveals nothing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/invitations/preview')
        .set(CSRF)
        .send({ token: 'x'.repeat(43) })
        .expect(404);
      expect(res.body.code).toBe('invitation_not_found');
    });
  });

  describe('who can accept', () => {
    it('needs a signed-in user', async () => {
      const { token } = await invite(app, owner.agent, uniqueEmail('anon'), [
        cashierRole,
      ]);
      const res = await accept(client(app), token).expect(401);
      expect(res.body.code).toBe('unauthenticated');
    });

    it('refuses a user whose email is different', async () => {
      const { token } = await invite(app, owner.agent, uniqueEmail('right'), [
        cashierRole,
      ]);
      const wrong = await signedInUser(app, 'wrong');
      const res = await accept(wrong.agent, token).expect(403);
      expect(res.body.code).toBe('invitation_email_mismatch');
      expect(
        await prisma.shopMembership.count({ where: { shopId: owner.shopId } }),
      ).toBe(1);
    });

    it('matches the email regardless of case', async () => {
      const email = uniqueEmail('mixed');
      await owner.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email: email.toUpperCase(), roleIds: [cashierRole] })
        .expect(201);
      const { token } = await lastMailTo(app, email);
      const staff = await signedInUser(app, 'mixed', email);
      await accept(staff.agent, token!).expect(200);
    });
  });

  describe('expiry, revocation and resending', () => {
    it('an expired invitation cannot be accepted; resending sends a new link', async () => {
      const email = uniqueEmail('late');
      const { invitationId, token } = await invite(app, owner.agent, email, [
        cashierRole,
      ]);
      await expire(invitationId);
      const staff = await signedInUser(app, 'late', email);
      expect((await accept(staff.agent, token).expect(410)).body.code).toBe(
        'invitation_expired',
      );
      const list = (
        await owner.agent.get('/api/v1/shops/current/invitations').expect(200)
      ).body.invitations;
      expect(list[0].status).toBe('EXPIRED');

      const resent = await owner.agent
        .post(`/api/v1/shops/current/invitations/${invitationId}/resend`)
        .expect(200);
      expect(resent.body).toMatchObject({ status: 'PENDING', resendCount: 1 });
      const { token: fresh } = await lastMailTo(app, email);
      expect(fresh).not.toBe(token);
      expect((await accept(staff.agent, token).expect(404)).body.code).toBe(
        'invitation_not_found',
      );
      await accept(staff.agent, fresh!).expect(200);
    });

    it('resending a pending invitation replaces its link', async () => {
      const email = uniqueEmail('resend');
      const { invitationId, token } = await invite(app, owner.agent, email, [
        cashierRole,
      ]);
      await owner.agent
        .post(`/api/v1/shops/current/invitations/${invitationId}/resend`)
        .expect(200);
      const { token: fresh } = await lastMailTo(app, email);
      const staff = await signedInUser(app, 'resend', email);
      await accept(staff.agent, token).expect(404);
      await accept(staff.agent, fresh!).expect(200);
    });

    it(`stops resending after ${MAX_RESENDS} times`, async () => {
      const { invitationId } = await invite(
        app,
        owner.agent,
        uniqueEmail('spam'),
        [cashierRole],
      );
      for (let i = 0; i < MAX_RESENDS; i += 1) {
        await owner.agent
          .post(`/api/v1/shops/current/invitations/${invitationId}/resend`)
          .expect(200);
      }
      const res = await owner.agent
        .post(`/api/v1/shops/current/invitations/${invitationId}/resend`)
        .expect(429);
      expect(res.body.code).toBe('resend_limit');
    });

    it('a revoked invitation cannot be accepted, resent or revoked again', async () => {
      const email = uniqueEmail('revoked');
      const { invitationId, token } = await invite(app, owner.agent, email, [
        cashierRole,
      ]);
      const revoked = await owner.agent
        .post(`/api/v1/shops/current/invitations/${invitationId}/revoke`)
        .expect(200);
      expect(revoked.body.status).toBe('REVOKED');

      const staff = await signedInUser(app, 'revoked', email);
      expect((await accept(staff.agent, token).expect(410)).body.code).toBe(
        'invitation_revoked',
      );
      const preview = await request(app.getHttpServer())
        .post('/api/v1/invitations/preview')
        .set(CSRF)
        .send({ token })
        .expect(200);
      expect(preview.body.status).toBe('REVOKED');
      for (const action of ['resend', 'revoke']) {
        const res = await owner.agent
          .post(`/api/v1/shops/current/invitations/${invitationId}/${action}`)
          .expect(409);
        expect(res.body.code).toBe('invitation_not_pending');
      }
    });

    it('an accepted invitation cannot be revoked', async () => {
      const email = uniqueEmail('done');
      const { invitationId, token } = await invite(app, owner.agent, email, [
        cashierRole,
      ]);
      const staff = await signedInUser(app, 'done', email);
      await accept(staff.agent, token).expect(200);
      await owner.agent
        .post(`/api/v1/shops/current/invitations/${invitationId}/revoke`)
        .expect(409);
    });
  });

  describe('who can be invited', () => {
    it('refuses a second pending invitation to the same email', async () => {
      const email = uniqueEmail('twice');
      await invite(app, owner.agent, email, [cashierRole]);
      const res = await owner.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email, roleIds: [cashierRole] })
        .expect(409);
      expect(res.body.code).toBe('invitation_pending');
    });

    it('allows a new invitation once the old one has expired', async () => {
      const email = uniqueEmail('again');
      const { invitationId } = await invite(app, owner.agent, email, [
        cashierRole,
      ]);
      await expire(invitationId);
      await invite(app, owner.agent, email, [cashierRole]);
    });

    it('refuses someone who is already a member', async () => {
      const member = await joinWithRoles(app, owner, 'member', [cashierRole]);
      const res = await owner.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email: member.email, roleIds: [cashierRole] })
        .expect(409);
      expect(res.body.code).toBe('already_member');
    });

    it('lets a removed member be invited back with new roles', async () => {
      const member = await joinWithRoles(app, owner, 'returning', [
        cashierRole,
      ]);
      await owner.agent
        .delete(`/api/v1/shops/current/members/${member.membershipId}`)
        .expect(204);
      const storekeeper = await roleId(owner.agent, 'Storekeeper');
      const { token } = await invite(app, owner.agent, member.email, [
        storekeeper,
      ]);
      await accept(member.agent, token).expect(200);

      const row = (
        await owner.agent.get('/api/v1/shops/current/members').expect(200)
      ).body.members.find(
        (m: { membershipId: string }) => m.membershipId === member.membershipId,
      );
      expect(row).toMatchObject({
        status: 'ACTIVE',
        roles: [{ id: storekeeper, name: 'Storekeeper' }],
      });
    });

    it('needs users.invite, and the inviter must hold every permission in the roles', async () => {
      const reader = await joinWithRoles(app, owner, 'reader', [
        await createRole(owner, 'Reader', ['users.read']),
      ]);
      const denied = await reader.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email: uniqueEmail('x'), roleIds: [cashierRole] })
        .expect(403);
      expect(denied.body.code).toBe('permission_denied');

      const manager = await joinWithRoles(app, owner, 'manager', [
        await roleId(owner.agent, 'Manager'),
      ]);
      await invite(app, manager.agent, uniqueEmail('cashier'), [cashierRole]);
      const admin = await createRole(owner, 'Admin', [
        'users.manage',
        'roles.manage',
      ]);
      const escalate = await manager.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email: uniqueEmail('admin'), roleIds: [admin] })
        .expect(403);
      expect(escalate.body.code).toBe('permission_escalation');
    });

    it('needs at least one role and a valid email', async () => {
      for (const body of [
        { email: uniqueEmail('noroles'), roleIds: [] },
        { email: 'not-an-email', roleIds: [cashierRole] },
      ]) {
        const res = await owner.agent
          .post('/api/v1/shops/current/invitations')
          .send(body)
          .expect(400);
        expect(res.body.code).toBe('bad_request');
      }
    });

    it('cannot accept into a suspended shop', async () => {
      const email = uniqueEmail('suspended');
      const { token } = await invite(app, owner.agent, email, [cashierRole]);
      await prisma.shop.update({
        where: { id: owner.shopId },
        data: { status: 'SUSPENDED' },
      });
      const staff = await signedInUser(app, 'suspended', email);
      expect((await accept(staff.agent, token).expect(403)).body.code).toBe(
        'shop_suspended',
      );
    });
  });

  describe('seat limit (from the plan, decision D-005)', () => {
    it('counts members and pending invitations, and frees a seat when one is revoked or expires', async () => {
      const shopOwner = await ownerWithShop(app, 'seatowner');
      await makePaid(
        app,
        shopOwner.shopId,
        await insertPlan(app, { seats: 2 }),
      );
      const role = await roleId(shopOwner.agent, 'Cashier');
      const first = await invite(app, shopOwner.agent, uniqueEmail('seat1'), [
        role,
      ]);

      const full = await shopOwner.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email: uniqueEmail('seat2'), roleIds: [role] })
        .expect(402);
      expect(full.body.code).toBe('seat_limit_reached');

      await shopOwner.agent
        .post(`/api/v1/shops/current/invitations/${first.invitationId}/revoke`)
        .expect(200);
      const second = await invite(app, shopOwner.agent, uniqueEmail('seat3'), [
        role,
      ]);

      // The expired invitation gives its seat back, so a third can be sent;
      // resending the expired one would then go over the limit.
      await prisma.invitation.update({
        where: { id: second.invitationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await invite(app, shopOwner.agent, uniqueEmail('seat4'), [role]);
      const resend = await shopOwner.agent
        .post(`/api/v1/shops/current/invitations/${second.invitationId}/resend`)
        .expect(402);
      expect(resend.body.code).toBe('seat_limit_reached');
    });

    it('is checked again at acceptance, and the trial has no limit', async () => {
      const shopOwner = await ownerWithShop(app, 'seatacc');
      const role = await roleId(shopOwner.agent, 'Cashier');
      // During the trial: no limit.
      const a = await invite(app, shopOwner.agent, uniqueEmail('seatacc1'), [
        role,
      ]);
      const bEmail = uniqueEmail('seatacc2');
      const b = await invite(app, shopOwner.agent, bEmail, [role]);
      // Now on a 2-seat plan: owner + two pending invitations is over the
      // limit, so the first acceptance is refused until a seat is freed.
      await makePaid(
        app,
        shopOwner.shopId,
        await insertPlan(app, { seats: 2 }),
      );
      const staff = await signedInUser(app, 'seatacc2', bEmail);
      expect((await accept(staff.agent, b.token).expect(402)).body.code).toBe(
        'seat_limit_reached',
      );
      await shopOwner.agent
        .post(`/api/v1/shops/current/invitations/${a.invitationId}/revoke`)
        .expect(200);
      await accept(staff.agent, b.token).expect(200);
      // Owner and the new member fill both seats.
      const third = await shopOwner.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email: uniqueEmail('seatacc3'), roleIds: [role] })
        .expect(402);
      expect(third.body.code).toBe('seat_limit_reached');
    });
  });
});
