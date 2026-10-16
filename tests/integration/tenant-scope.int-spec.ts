import type { INestApplication } from '@nestjs/common';
import { newId } from '../../backend/src/common/ids/ids.js';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import {
  GLOBAL_MODELS,
  Prisma,
  scopedToShop,
  TENANT_MODELS,
  TenantScopeError,
} from '../../backend/src/database/index.js';
import { createTestApp } from './helpers/app.js';
import { ownerWithShop, resetDatabase } from './helpers/auth.js';

/** The data-access safety net behind every shop-scoped service. */
describe('Tenant-scoped Prisma client (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alpha: { shopId: string; userId: string };
  let beta: { shopId: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    alpha = await ownerWithShop(app, 'scope-a');
    beta = await ownerWithShop(app, 'scope-b');
  });
  afterAll(() => app.close());

  it('classifies every Prisma model exactly once', () => {
    const tenant = Object.keys(TENANT_MODELS);
    const global = [...GLOBAL_MODELS] as string[];
    expect(tenant.filter((m) => global.includes(m))).toEqual([]);
    expect([...tenant, ...global].sort()).toEqual(
      Object.values(Prisma.ModelName).sort(),
    );
  });

  it('reads only the scoped shop’s rows', async () => {
    const db = scopedToShop(prisma, alpha.shopId);
    const rows = await db.shopMembership.findMany();
    expect(rows.map((r) => r.shopId)).toEqual([alpha.shopId]);
    expect(await db.shop.findUnique({ where: { id: beta.shopId } })).toBeNull();
    expect(
      await db.shopMembership.count({ where: { shopId: beta.shopId } }),
    ).toBe(0);
    // An explicit OR cannot widen the filter.
    const widened = await db.shopMembership.findMany({
      where: { OR: [{ shopId: beta.shopId }, { shopId: alpha.shopId }] },
    });
    expect(widened.map((r) => r.shopId)).toEqual([alpha.shopId]);
  });

  it('cannot update or delete another shop’s rows', async () => {
    const db = scopedToShop(prisma, alpha.shopId);
    const result = await db.shopMembership.updateMany({
      where: { userId: beta.userId },
      data: { isOwner: false },
    });
    expect(result.count).toBe(0);
    await expect(
      db.shop.update({ where: { id: beta.shopId }, data: { name: 'x' } }),
    ).rejects.toThrow();
    const betaMembership = await prisma.shopMembership.findFirstOrThrow({
      where: { shopId: beta.shopId },
    });
    expect(betaMembership.isOwner).toBe(true);
  });

  it('fills in the shop id on create and refuses a different one', async () => {
    const db = scopedToShop(prisma, alpha.shopId);
    const created = await db.auditLog.create({
      data: { id: newId(), action: 'test.scoped' },
    });
    expect(created.shopId).toBe(alpha.shopId);
    await expect(
      db.auditLog.create({
        data: { id: newId(), action: 'test.cross', shopId: beta.shopId },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it('refuses to move a row to another shop', async () => {
    const db = scopedToShop(prisma, alpha.shopId);
    await expect(
      db.shopMembership.updateMany({
        where: {},
        data: { shopId: beta.shopId },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it('refuses global models and raw queries through the scoped client', async () => {
    const db = scopedToShop(prisma, alpha.shopId);
    await expect(db.user.findMany()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.session.count()).rejects.toBeInstanceOf(TenantScopeError);
  });

  it('requires a shop id', () => {
    expect(() => scopedToShop(prisma, '')).toThrow(TenantScopeError);
  });
});
