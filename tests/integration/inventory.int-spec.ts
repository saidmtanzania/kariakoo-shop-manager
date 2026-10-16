import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  ownerWithShop,
  resetDatabase,
  resetRateLimits,
} from './helpers/auth.js';
import { adjust, createProduct, stockOf, unitId } from './helpers/products.js';
import { joinWithRoles, roleId } from './helpers/team.js';

type Owner = Awaited<ReturnType<typeof ownerWithShop>>;

/** The stock ledger, adjustments, concurrency and reconciliation (Phase 05). */
describe('Inventory (Phase 05)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(() => app.close());
  beforeEach(() => resetRateLimits(app));

  /** A product with `pieces` pieces in stock at 1,800 each. */
  async function stocked(owner: Owner, pieces = '24') {
    const product = await createProduct(owner.agent, {
      openingStock: { unitName: 'piece', quantity: pieces, unitCost: '1800' },
    });
    return {
      product,
      piece: unitId(product, 'piece'),
      carton: unitId(product, 'carton'),
    };
  }

  const reconciliation = async (owner: Owner) =>
    (
      await owner.agent
        .get('/api/v1/shops/current/inventory/reconciliation')
        .expect(200)
    ).body;

  describe('adjustments', () => {
    it('adds, removes and counts in any unit, converting to base units', async () => {
      const owner = await ownerWithShop(app, 'adjust');
      const { product, piece, carton } = await stocked(owner);

      const out = await adjust(owner.agent, {
        productId: product.id,
        unitId: carton,
        kind: 'remove',
        quantity: '1',
        reason: 'DAMAGED',
        note: 'Water damage',
      }).expect(201);
      expect(out.body.movement).toMatchObject({
        type: 'ADJUSTMENT_OUT',
        quantity: '-12.000',
        balanceAfter: '12.000',
        unitName: 'carton',
        unitQuantity: '1.000',
        conversion: '12.000',
        reason: 'DAMAGED',
        note: 'Water damage',
        actorName: 'adjust Tester',
        unitCost: '1800.0000',
      });
      expect(Date.parse(out.body.movement.createdAt)).not.toBeNaN();

      const add = await adjust(owner.agent, {
        productId: product.id,
        unitId: piece,
        kind: 'add',
        quantity: '3',
        reason: 'FOUND',
      }).expect(201);
      expect(add.body.movement).toMatchObject({
        type: 'ADJUSTMENT_IN',
        quantity: '3.000',
        balanceAfter: '15.000',
      });

      const count = await adjust(owner.agent, {
        productId: product.id,
        unitId: carton,
        kind: 'count',
        quantity: '1',
        reason: 'COUNT_CORRECTION',
      }).expect(201);
      expect(count.body.movement).toMatchObject({
        type: 'ADJUSTMENT_OUT',
        quantity: '-3.000',
        balanceAfter: '12.000',
      });
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('12.000');

      const audits = await prisma.auditLog.findMany({
        where: { shopId: owner.shopId, action: 'inventory.adjusted' },
        orderBy: { id: 'asc' },
      });
      expect(audits).toHaveLength(3);
      expect(audits[0]!.after).toMatchObject({
        kind: 'remove',
        reason: 'DAMAGED',
        unit: 'carton',
        baseChange: '-12',
        balanceAfter: '12.000',
      });
      expect((await reconciliation(owner)).mismatches).toEqual([]);
    });

    it('keeps the weighted-average cost (D-003) when stock is added with a cost', async () => {
      const owner = await ownerWithShop(app, 'average');
      const { product, carton } = await stocked(owner, '48');
      // 48 pieces at 1,800 + 1 carton (12 pieces) at 24,000 → 1,840 a piece.
      await adjust(owner.agent, {
        productId: product.id,
        unitId: carton,
        kind: 'add',
        quantity: '1',
        reason: 'FOUND',
        unitCost: '24000',
      }).expect(201);
      expect(await stockOf(owner.agent, product.id)).toMatchObject({
        quantity: '60.000',
        averageCost: '1840.0000',
      });
      // Removing stock does not change the average.
      await adjust(owner.agent, {
        productId: product.id,
        unitId: carton,
        kind: 'remove',
        quantity: '2',
        reason: 'LOST',
      }).expect(201);
      expect((await stockOf(owner.agent, product.id)).averageCost).toBe(
        '1840.0000',
      );
    });

    it.each([
      [
        'more than the stock on record',
        { kind: 'remove', quantity: '3', unit: 'carton' },
        409,
        'insufficient_stock',
      ],
      [
        'a fraction of a whole-number unit (D-013)',
        { kind: 'remove', quantity: '1.5', unit: 'carton' },
        422,
        'fraction_not_allowed',
      ],
      [
        'zero to add',
        { kind: 'add', quantity: '0', unit: 'piece' },
        400,
        undefined,
      ],
      [
        'a negative quantity',
        { kind: 'add', quantity: '-1', unit: 'piece' },
        400,
        undefined,
      ],
      [
        'more than 3 decimals',
        { kind: 'add', quantity: '1.2345', unit: 'piece' },
        400,
        undefined,
      ],
      [
        'a count equal to the stock',
        { kind: 'count', quantity: '24', unit: 'piece' },
        409,
        'adjustment_no_change',
      ],
      [
        'a cost on removed stock',
        { kind: 'remove', quantity: '1', unit: 'piece', unitCost: '100' },
        422,
        'cost_only_for_added_stock',
      ],
      [
        'OTHER without a note',
        { kind: 'remove', quantity: '1', unit: 'piece', reason: 'OTHER' },
        400,
        undefined,
      ],
      [
        'an unknown reason',
        { kind: 'remove', quantity: '1', unit: 'piece', reason: 'THEFT' },
        400,
        undefined,
      ],
    ])(
      'refuses %s and changes nothing',
      async (_label, input, status, code) => {
        const owner = await ownerWithShop(app, 'invalidadj');
        const { product, piece, carton } = await stocked(owner);
        const res = await adjust(owner.agent, {
          productId: product.id,
          unitId: input.unit === 'carton' ? carton : piece,
          kind: input.kind as 'add',
          quantity: input.quantity,
          reason: (input as { reason?: string }).reason ?? 'COUNT_CORRECTION',
          unitCost: (input as { unitCost?: string }).unitCost,
        }).expect(status);
        if (code) expect(res.body.code).toBe(code);
        expect((await stockOf(owner.agent, product.id)).quantity).toBe(
          '24.000',
        );
        expect(
          await prisma.stockMovement.count({
            where: { productId: product.id },
          }),
        ).toBe(1);
        expect(
          await prisma.stockAdjustment.count({
            where: { shopId: owner.shopId },
          }),
        ).toBe(0);
      },
    );

    it('refuses a unit of another product and an archived unit', async () => {
      const owner = await ownerWithShop(app, 'wrongunit');
      const a = await stocked(owner);
      const b = await stocked(owner);
      const res = await adjust(owner.agent, {
        productId: a.product.id,
        unitId: b.carton,
        kind: 'remove',
        quantity: '1',
      }).expect(404);
      expect(res.body.code).toBe('unit_not_found');
      await owner.agent
        .patch(
          `/api/v1/shops/current/products/${a.product.id}/units/${a.carton}`,
        )
        .send({ archived: true })
        .expect(200);
      await adjust(owner.agent, {
        productId: a.product.id,
        unitId: a.carton,
        kind: 'remove',
        quantity: '1',
      }).expect(404);
    });
  });

  describe('retries and concurrency', () => {
    it('returns the first result when a request is retried with the same key', async () => {
      const owner = await ownerWithShop(app, 'retry');
      const { product, piece } = await stocked(owner);
      const body = {
        productId: product.id,
        unitId: piece,
        kind: 'remove' as const,
        quantity: '2',
        reason: 'DAMAGED',
        idempotencyKey: 'retry-key-0001',
      };
      const first = await adjust(owner.agent, body).expect(201);
      const second = await adjust(owner.agent, body).expect(201);
      expect(second.body.adjustmentId).toBe(first.body.adjustmentId);
      expect(second.body.movement.id).toBe(first.body.movement.id);
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('22.000');

      const different = await adjust(owner.agent, {
        ...body,
        quantity: '3',
      }).expect(409);
      expect(different.body.code).toBe('idempotency_conflict');
    });

    it('records one adjustment when the same request arrives five times at once', async () => {
      const owner = await ownerWithShop(app, 'retryrace');
      const { product, piece } = await stocked(owner);
      const body = {
        productId: product.id,
        unitId: piece,
        kind: 'remove' as const,
        quantity: '1',
        reason: 'DAMAGED',
        idempotencyKey: 'race-key-0001',
      };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => adjust(owner.agent, body)),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.movement.id)).size).toBe(1);
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('23.000');
    });

    it('never goes below zero when 20 removals of 1 race for 10 in stock', async () => {
      const owner = await ownerWithShop(app, 'oversell');
      const { product, piece } = await stocked(owner, '10');
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          adjust(owner.agent, {
            productId: product.id,
            unitId: piece,
            kind: 'remove',
            quantity: '1',
            reason: 'DAMAGED',
          }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(10);
      const refused = results.filter((r) => r.status === 409);
      expect(refused).toHaveLength(10);
      expect(refused.every((r) => r.body.code === 'insufficient_stock')).toBe(
        true,
      );
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('0.000');
      const balances = (
        await prisma.stockMovement.findMany({
          where: { productId: product.id },
          orderBy: { id: 'asc' },
          select: { balanceAfter: true },
        })
      ).map((r) => Number(r.balanceAfter));
      expect(balances).toEqual([...balances].sort((a, b) => b - a));
      expect(Math.min(...balances)).toBe(0);
      expect((await reconciliation(owner)).mismatches).toEqual([]);
    });

    it('applies concurrent additions and removals exactly', async () => {
      const owner = await ownerWithShop(app, 'mixed');
      const { product, piece, carton } = await stocked(owner, '100');
      const requests = [
        ...Array.from({ length: 10 }, () => ({
          unitId: carton,
          kind: 'add' as const,
        })),
        ...Array.from({ length: 10 }, () => ({
          unitId: piece,
          kind: 'remove' as const,
        })),
      ];
      const results = await Promise.all(
        requests.map((r) =>
          adjust(owner.agent, {
            productId: product.id,
            ...r,
            quantity: '1',
            reason: 'COUNT_CORRECTION',
          }),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      // 100 + 10 × 12 − 10 × 1 = 210
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('210.000');
      expect((await reconciliation(owner)).mismatches).toEqual([]);
    });
  });

  describe('opening stock', () => {
    it('is recorded once, before any other movement', async () => {
      const owner = await ownerWithShop(app, 'opening');
      const product = await createProduct(owner.agent);
      const carton = unitId(product, 'carton');
      const url = `/api/v1/shops/current/products/${product.id}/opening-stock`;
      const first = await owner.agent
        .post(url)
        .send({ unitId: carton, quantity: '3', unitCost: '21600' })
        .expect(201);
      expect(first.body).toMatchObject({
        type: 'OPENING',
        quantity: '36.000',
        unitCost: '1800.0000',
      });
      const again = await owner.agent
        .post(url)
        .send({ unitId: carton, quantity: '1' })
        .expect(409);
      expect(again.body.code).toBe('opening_stock_exists');
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('36.000');

      const audit = await prisma.auditLog.findFirst({
        where: { shopId: owner.shopId, action: 'inventory.opening_recorded' },
      });
      expect(audit?.after).toMatchObject({
        unit: 'carton',
        baseQuantity: '36',
      });
    });

    it('is refused after an adjustment, and when sent twice at once only one counts', async () => {
      const owner = await ownerWithShop(app, 'openingrace');
      const product = await createProduct(owner.agent);
      const piece = unitId(product, 'piece');
      const url = `/api/v1/shops/current/products/${product.id}/opening-stock`;
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          owner.agent.post(url).send({ unitId: piece, quantity: '5' }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('5.000');

      const other = await createProduct(owner.agent);
      await adjust(owner.agent, {
        productId: other.id,
        unitId: unitId(other, 'piece'),
        kind: 'add',
        quantity: '1',
      }).expect(201);
      await owner.agent
        .post(`/api/v1/shops/current/products/${other.id}/opening-stock`)
        .send({ unitId: unitId(other, 'piece'), quantity: '5' })
        .expect(409);
    });

    it('needs inventory.opening (a storekeeper can adjust but not enter opening stock)', async () => {
      const owner = await ownerWithShop(app, 'openingperm');
      const keeper = await joinWithRoles(app, owner, 'keeper', [
        await roleId(owner.agent, 'Storekeeper'),
      ]);
      const product = await createProduct(owner.agent);
      const piece = unitId(product, 'piece');
      await keeper.agent
        .post(`/api/v1/shops/current/products/${product.id}/opening-stock`)
        .send({ unitId: piece, quantity: '5' })
        .expect(403);
      await adjust(keeper.agent, {
        productId: product.id,
        unitId: piece,
        kind: 'add',
        quantity: '5',
        reason: 'FOUND',
      }).expect(201);
      // ...but not with a cost, which needs cost access.
      const cost = await adjust(keeper.agent, {
        productId: product.id,
        unitId: piece,
        kind: 'add',
        quantity: '1',
        reason: 'FOUND',
        unitCost: '1000',
      }).expect(403);
      expect(cost.body.code).toBe('permission_denied');
    });
  });

  describe('negative stock setting (D-007)', () => {
    it('is off by default, changed only by an owner, and audited', async () => {
      const owner = await ownerWithShop(app, 'negative');
      const manager = await joinWithRoles(app, owner, 'manager', [
        await roleId(owner.agent, 'Manager'),
      ]);
      const url = '/api/v1/shops/current/inventory/settings';
      expect((await owner.agent.get(url).expect(200)).body).toEqual({
        allowNegativeStock: false,
      });
      const refused = await manager.agent
        .put(url)
        .send({ allowNegativeStock: true })
        .expect(403);
      expect(refused.body.code).toBe('owner_required');
      await owner.agent.put(url).send({ allowNegativeStock: true }).expect(200);
      expect((await manager.agent.get(url).expect(200)).body).toEqual({
        allowNegativeStock: true,
      });
      const audit = await prisma.auditLog.findFirst({
        where: { shopId: owner.shopId, action: 'inventory.settings_updated' },
      });
      expect(audit).toMatchObject({
        before: { allowNegativeStock: false },
        after: { allowNegativeStock: true },
      });
    });

    it('never lets an adjustment take stock below zero, even when sales may', async () => {
      const owner = await ownerWithShop(app, 'negadj');
      const { product, piece } = await stocked(owner, '2');
      await owner.agent
        .put('/api/v1/shops/current/inventory/settings')
        .send({ allowNegativeStock: true })
        .expect(200);
      const res = await adjust(owner.agent, {
        productId: product.id,
        unitId: piece,
        kind: 'remove',
        quantity: '3',
        reason: 'DAMAGED',
      }).expect(409);
      expect(res.body.code).toBe('insufficient_stock');
    });
  });

  describe('ledger integrity', () => {
    it('reports a balance that no longer matches its movements', async () => {
      const owner = await ownerWithShop(app, 'recon');
      const { product } = await stocked(owner, '7');
      expect(await reconciliation(owner)).toEqual({
        checkedProducts: 1,
        mismatches: [],
      });
      // Simulate a change made outside the inventory service.
      await prisma.$executeRaw`UPDATE stock_balances SET quantity = 9 WHERE product_id = ${product.id}::uuid`;
      expect((await reconciliation(owner)).mismatches).toEqual([
        {
          productId: product.id,
          productName: product.name,
          balance: '9.000',
          ledgerTotal: '7.000',
        },
      ]);
    });

    it('refuses to edit or delete movements, adjustments and price history', async () => {
      const owner = await ownerWithShop(app, 'appendonly');
      const { product, piece } = await stocked(owner, '7');
      await adjust(owner.agent, {
        productId: product.id,
        unitId: piece,
        kind: 'remove',
        quantity: '1',
        reason: 'DAMAGED',
      }).expect(201);
      const statements = [
        `UPDATE stock_movements SET quantity = 100 WHERE product_id = '${product.id}'`,
        `DELETE FROM stock_movements WHERE product_id = '${product.id}'`,
        `UPDATE stock_adjustments SET reason = 'FOUND' WHERE shop_id = '${owner.shopId}'`,
        `DELETE FROM stock_adjustments WHERE shop_id = '${owner.shopId}'`,
        `UPDATE price_history SET retail_price = 1 WHERE shop_id = '${owner.shopId}'`,
        `DELETE FROM product_units WHERE product_id = '${product.id}'`,
      ];
      for (const sql of statements) {
        await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
      }
      expect(
        await prisma.stockMovement.count({ where: { productId: product.id } }),
      ).toBe(2);
    });

    it('summarises low, out-of-stock and negative products for alerts', async () => {
      const owner = await ownerWithShop(app, 'summary');
      await createProduct(owner.agent, {
        reorderLevel: '10',
        openingStock: { unitName: 'piece', quantity: '4' },
      });
      await createProduct(owner.agent);
      await createProduct(owner.agent, {
        reorderLevel: '2',
        openingStock: { unitName: 'piece', quantity: '30' },
      });
      const summary = await owner.agent
        .get('/api/v1/shops/current/inventory/summary')
        .expect(200);
      expect(summary.body).toEqual({
        productCount: 3,
        lowStockCount: 1,
        outOfStockCount: 1,
        negativeCount: 0,
        allowNegativeStock: false,
      });
      const low = await owner.agent
        .get('/api/v1/shops/current/products?stock=low')
        .expect(200);
      expect(low.body.products).toHaveLength(1);
      expect(low.body.products[0]).toMatchObject({
        quantity: '4.000',
        lowStock: true,
      });
      const out = await owner.agent
        .get('/api/v1/shops/current/products?stock=out')
        .expect(200);
      expect(out.body.products).toHaveLength(1);
    });

    it('pages the movement history newest first', async () => {
      const owner = await ownerWithShop(app, 'history');
      const { product, piece } = await stocked(owner, '20');
      for (let i = 0; i < 4; i += 1) {
        await adjust(owner.agent, {
          productId: product.id,
          unitId: piece,
          kind: 'remove',
          quantity: '1',
          reason: 'OWN_USE',
        }).expect(201);
      }
      const page1 = await owner.agent
        .get(
          `/api/v1/shops/current/inventory/movements?productId=${product.id}&limit=3`,
        )
        .expect(200);
      expect(
        page1.body.movements.map(
          (m: { balanceAfter: string }) => m.balanceAfter,
        ),
      ).toEqual(['16.000', '17.000', '18.000']);
      const page2 = await owner.agent
        .get(
          `/api/v1/shops/current/inventory/movements?productId=${product.id}&limit=3&cursor=${page1.body.nextCursor}`,
        )
        .expect(200);
      expect(page2.body.movements.map((m: { type: string }) => m.type)).toEqual(
        ['ADJUSTMENT_OUT', 'OPENING'],
      );
      expect(page2.body.nextCursor).toBeNull();
    });
  });
});
