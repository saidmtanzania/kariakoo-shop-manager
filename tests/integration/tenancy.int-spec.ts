import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { newId } from '../../backend/src/common/ids/ids.js';
import { createTestApp } from './helpers/app.js';
import {
  client,
  CSRF,
  ownerWithShop,
  PASSWORD,
  resetDatabase,
  signedInUser,
} from './helpers/auth.js';

/**
 * Shop isolation (decision A-002, security model section 5). Two shops,
 * "Alpha" and "Beta", each with an owner; every attempt by one side to read
 * or change the other's data must fail.
 */
describe('Shop isolation (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alpha: Awaited<ReturnType<typeof ownerWithShop>>;
  let beta: Awaited<ReturnType<typeof ownerWithShop>>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    alpha = await ownerWithShop(app, 'alpha', 'Alpha Traders');
    beta = await ownerWithShop(app, 'beta', 'Beta Wholesale');
  });
  afterAll(() => app.close());

  /** Adds a non-owner member directly; invitations arrive in Phase 03. */
  async function addMember(shopId: string, label: string) {
    const user = await signedInUser(app, label);
    await prisma.shopMembership.create({
      data: { id: newId(), shopId, userId: user.userId },
    });
    await user.agent
      .put('/api/v1/auth/session/active-shop')
      .send({ shopId })
      .expect(204);
    return user;
  }

  describe('unauthenticated and invalid sessions', () => {
    it.each([
      ['get', '/api/v1/shops'],
      ['post', '/api/v1/shops'],
      ['get', '/api/v1/shops/current'],
      ['patch', '/api/v1/shops/current'],
      ['get', '/api/v1/shops/current/members'],
      ['get', '/api/v1/auth/session'],
      ['put', '/api/v1/auth/session/active-shop'],
      ['post', '/api/v1/auth/logout'],
    ] as const)('%s %s without a session is 401', async (method, path) => {
      const res = await request(app.getHttpServer())
        [method](path)
        .set(CSRF)
        .send({})
        .expect(401);
      expect(res.body.code).toBe('unauthenticated');
    });

    it('rejects a forged or malformed session cookie and clears it', async () => {
      for (const value of [
        'forged-token-value',
        'a'.repeat(43),
        'x'.repeat(500),
      ]) {
        const res = await request(app.getHttpServer())
          .get('/api/v1/shops/current')
          .set('Cookie', `ksm_session=${value}`)
          .expect(401);
        expect(String(res.headers['set-cookie'])).toMatch(/ksm_session=;/);
      }
    });

    it('does not accept the stored token hash as a cookie', async () => {
      const session = await prisma.session.findFirstOrThrow({
        where: { userId: alpha.userId },
      });
      await request(app.getHttpServer())
        .get('/api/v1/shops/current')
        .set('Cookie', `ksm_session=${session.tokenHash}`)
        .expect(401);
    });
  });

  describe('shop creation and the active shop', () => {
    it('makes the creator the owner and the new shop active', async () => {
      const shop = await alpha.agent.get('/api/v1/shops/current').expect(200);
      expect(shop.body).toMatchObject({
        id: alpha.shopId,
        name: 'Alpha Traders',
        currency: 'TZS',
        timezone: 'Africa/Dar_es_Salaam',
        status: 'ACTIVE',
      });
      const session = await alpha.agent.get('/api/v1/auth/session').expect(200);
      expect(session.body.activeShopId).toBe(alpha.shopId);
      expect(session.body.memberships).toEqual([
        expect.objectContaining({
          shopId: alpha.shopId,
          shopName: 'Alpha Traders',
          isOwner: true,
        }),
      ]);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'shop.created', shopId: alpha.shopId },
      });
      expect(audit.actorUserId).toBe(alpha.userId);
    });

    it('requires a chosen shop for shop routes', async () => {
      const loner = await signedInUser(app, 'loner');
      const res = await loner.agent.get('/api/v1/shops/current').expect(403);
      expect(res.body.code).toBe('no_active_shop');
    });

    it('lets a member of several shops switch between them', async () => {
      const second = await alpha.agent
        .post('/api/v1/shops')
        .send({ name: 'Alpha Branch' })
        .expect(201);
      expect((await alpha.agent.get('/api/v1/shops/current')).body.name).toBe(
        'Alpha Branch',
      );
      await alpha.agent
        .put('/api/v1/auth/session/active-shop')
        .send({ shopId: alpha.shopId })
        .expect(204);
      expect((await alpha.agent.get('/api/v1/shops/current')).body.name).toBe(
        'Alpha Traders',
      );
      const list = await alpha.agent.get('/api/v1/shops').expect(200);
      expect(
        list.body.shops.map((s: { shopId: string }) => s.shopId).sort(),
      ).toEqual([alpha.shopId, second.body.id].sort());
    });

    it('signs in without choosing a shop when the user has several', async () => {
      await alpha.agent
        .post('/api/v1/shops')
        .send({ name: 'Alpha Branch' })
        .expect(201);
      const fresh = client(app);
      await fresh
        .post('/api/v1/auth/login')
        .send({ email: alpha.email, password: PASSWORD })
        .expect(204);
      expect(
        (await fresh.get('/api/v1/auth/session')).body.activeShopId,
      ).toBeNull();
    });

    it('chooses the only shop automatically at sign-in', async () => {
      const fresh = client(app);
      await fresh
        .post('/api/v1/auth/login')
        .send({ email: beta.email, password: PASSWORD })
        .expect(204);
      expect((await fresh.get('/api/v1/auth/session')).body.activeShopId).toBe(
        beta.shopId,
      );
    });
  });

  describe('cross-tenant reads', () => {
    it('cannot switch into a shop the user does not belong to', async () => {
      const res = await beta.agent
        .put('/api/v1/auth/session/active-shop')
        .send({ shopId: alpha.shopId })
        .expect(404);
      expect(res.body.code).toBe('shop_not_found');
      // Same answer as a shop that does not exist, so shop ids cannot be probed.
      const missing = await beta.agent
        .put('/api/v1/auth/session/active-shop')
        .send({ shopId: newId() })
        .expect(404);
      expect(missing.body.code).toBe('shop_not_found');
      expect((await beta.agent.get('/api/v1/shops/current')).body.id).toBe(
        beta.shopId,
      );
    });

    it('ignores shop ids sent in the query, headers or path', async () => {
      const res = await beta.agent
        .get(`/api/v1/shops/current?shopId=${alpha.shopId}`)
        .set('x-shop-id', alpha.shopId)
        .expect(200);
      expect(res.body.id).toBe(beta.shopId);
      await beta.agent.get(`/api/v1/shops/${alpha.shopId}`).expect(404);
      await beta.agent.get(`/api/v1/shops/${alpha.shopId}/members`).expect(404);
    });

    it('lists only the active shop’s members', async () => {
      const res = await beta.agent
        .get('/api/v1/shops/current/members')
        .expect(200);
      expect(res.body.members.map((m: { userId: string }) => m.userId)).toEqual(
        [beta.userId],
      );
    });

    it('lists only the user’s own shops', async () => {
      const res = await beta.agent.get('/api/v1/shops').expect(200);
      expect(res.body.shops.map((s: { shopId: string }) => s.shopId)).toEqual([
        beta.shopId,
      ]);
      const session = await beta.agent.get('/api/v1/auth/session').expect(200);
      expect(JSON.stringify(session.body)).not.toContain(alpha.shopId);
    });

    it('ignores an active shop planted in the session row without a membership', async () => {
      await prisma.session.updateMany({
        where: { userId: beta.userId },
        data: { activeShopId: alpha.shopId },
      });
      const res = await beta.agent.get('/api/v1/shops/current').expect(403);
      expect(res.body.code).toBe('shop_access_revoked');
      const session = await beta.agent.get('/api/v1/auth/session').expect(200);
      expect(session.body.activeShopId).toBeNull();
    });
  });

  describe('cross-tenant writes', () => {
    it('rejects a shopId or id smuggled into an update body', async () => {
      for (const body of [
        { name: 'Hijack', shopId: alpha.shopId },
        { name: 'Hijack', id: alpha.shopId },
      ]) {
        const res = await beta.agent
          .patch('/api/v1/shops/current')
          .send(body)
          .expect(400);
        expect(res.body.code).toBe('bad_request');
      }
      const alphaShop = await prisma.shop.findUniqueOrThrow({
        where: { id: alpha.shopId },
      });
      expect(alphaShop.name).toBe('Alpha Traders');
    });

    it('rejects an id or status smuggled into shop creation', async () => {
      await beta.agent
        .post('/api/v1/shops')
        .send({ name: 'Copy', id: alpha.shopId })
        .expect(400);
      await beta.agent
        .post('/api/v1/shops')
        .send({ name: 'Free', status: 'ACTIVE', currency: 'USD' })
        .expect(400);
      expect(await prisma.shop.count()).toBe(2);
    });

    it('an update changes only the caller’s active shop and is audited', async () => {
      const res = await beta.agent
        .patch('/api/v1/shops/current')
        .send({ name: 'Beta Wholesale Ltd', phone: '+255 712 000 000' })
        .expect(200);
      expect(res.body).toMatchObject({
        id: beta.shopId,
        name: 'Beta Wholesale Ltd',
        phone: '+255 712 000 000',
      });
      expect(
        (await prisma.shop.findUniqueOrThrow({ where: { id: alpha.shopId } }))
          .name,
      ).toBe('Alpha Traders');

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'shop.updated' },
      });
      expect(audit.shopId).toBe(beta.shopId);
      expect(audit.before).toMatchObject({ name: 'Beta Wholesale' });
      expect(audit.after).toMatchObject({ name: 'Beta Wholesale Ltd' });
    });

    it('cannot change another shop through a forged route', async () => {
      await beta.agent
        .patch(`/api/v1/shops/${alpha.shopId}`)
        .send({ name: 'Hijack' })
        .expect(404);
      expect(
        (await prisma.shop.findUniqueOrThrow({ where: { id: alpha.shopId } }))
          .name,
      ).toBe('Alpha Traders');
    });
  });

  describe('memberships', () => {
    it('a non-owner member can read the shop but not change it', async () => {
      const staff = await addMember(alpha.shopId, 'staff');
      await staff.agent.get('/api/v1/shops/current').expect(200);
      const res = await staff.agent
        .patch('/api/v1/shops/current')
        .send({ name: 'Mine now' })
        .expect(403);
      expect(res.body.code).toBe('permission_denied');
    });

    it.each(['REMOVED', 'SUSPENDED'] as const)(
      'a %s membership loses access on the next request',
      async (status) => {
        const staff = await addMember(
          alpha.shopId,
          `staff-${status.toLowerCase()}`,
        );
        await staff.agent.get('/api/v1/shops/current').expect(200);
        await prisma.shopMembership.updateMany({
          where: { userId: staff.userId },
          data: { status },
        });

        const res = await staff.agent.get('/api/v1/shops/current').expect(403);
        expect(res.body.code).toBe('shop_access_revoked');
        const session = await staff.agent
          .get('/api/v1/auth/session')
          .expect(200);
        expect(session.body.activeShopId).toBeNull();
        expect(session.body.memberships).toEqual([]);
        await staff.agent
          .put('/api/v1/auth/session/active-shop')
          .send({ shopId: alpha.shopId })
          .expect(404);
      },
    );

    it('a suspended shop is closed to its own owner', async () => {
      await prisma.shop.update({
        where: { id: alpha.shopId },
        data: { status: 'SUSPENDED' },
      });
      const res = await alpha.agent.get('/api/v1/shops/current').expect(403);
      expect(res.body.code).toBe('shop_suspended');
      await alpha.agent
        .patch('/api/v1/shops/current')
        .send({ name: 'x' })
        .expect(403);
      await beta.agent.get('/api/v1/shops/current').expect(200);
    });
  });
});
