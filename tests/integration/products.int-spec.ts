import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  ownerWithShop,
  resetDatabase,
  resetRateLimits,
  type Client,
} from './helpers/auth.js';
import { insertPlan, makePaid, makeRestricted } from './helpers/billing.js';
import {
  adjust,
  createProduct,
  SOAP,
  stockOf,
  unitId,
} from './helpers/products.js';
import { createRole, joinWithRoles, roleId } from './helpers/team.js';

/** Products, units, prices, search and their access rules (Phase 05). */
describe('Products (Phase 05)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(() => app.close());
  beforeEach(() => resetRateLimits(app));

  describe('creating a product', () => {
    it('creates units, prices and opening stock converted to base units', async () => {
      const owner = await ownerWithShop(app, 'create');
      const product = await createProduct(owner.agent, {
        openingStock: { unitName: 'carton', quantity: '2', unitCost: '21600' },
        reorderLevel: '6',
      });
      expect(product.units.map((u: { name: string }) => u.name)).toEqual([
        'piece',
        'carton',
      ]);
      const carton = product.units[1];
      expect(carton).toMatchObject({
        conversion: '12.000',
        isBase: false,
        retailPrice: '24000.00',
        wholesalePrice: '23000.00',
        buyingPrice: '21600.00',
      });
      expect(product.units[0]).toMatchObject({
        conversion: '1.000',
        isBase: true,
        allowFraction: false,
      });
      // 2 cartons of 12 = 24 pieces, at 21,600 / 12 = 1,800 a piece.
      expect(product.stock).toMatchObject({
        quantity: '24.000',
        averageCost: '1800.0000',
        lowStock: false,
        hasMovements: true,
      });

      const movements = await owner.agent
        .get(
          `/api/v1/shops/current/inventory/movements?productId=${product.id}`,
        )
        .expect(200);
      expect(movements.body.movements).toHaveLength(1);
      expect(movements.body.movements[0]).toMatchObject({
        type: 'OPENING',
        quantity: '24.000',
        balanceAfter: '24.000',
        unitName: 'carton',
        unitQuantity: '2.000',
        conversion: '12.000',
        unitCost: '1800.0000',
        actorName: 'create Tester',
      });

      const history = await prisma.priceHistory.count({
        where: { shopId: owner.shopId },
      });
      expect(history).toBe(2);
      const audit = await prisma.auditLog.findFirst({
        where: { shopId: owner.shopId, action: 'product.created' },
      });
      expect(audit?.entityId).toBe(product.id);
    });

    it('creates a shop with a default stock location (D-002)', async () => {
      const owner = await ownerWithShop(app, 'location');
      const locations = await prisma.stockLocation.findMany({
        where: { shopId: owner.shopId },
      });
      expect(locations).toEqual([
        expect.objectContaining({ name: 'Main', isDefault: true }),
      ]);
    });

    it('rejects a duplicate SKU or barcode in the same shop but allows them in another', async () => {
      const a = await ownerWithShop(app, 'dupa');
      const b = await ownerWithShop(app, 'dupb');
      const first = await createProduct(a.agent, {
        sku: 'SAME-SKU',
        baseUnit: { name: 'piece', barcode: '6001234500001' },
        units: [],
      });
      expect(first.sku).toBe('SAME-SKU');

      const sku = await createProduct(
        a.agent,
        { sku: 'same-sku', baseUnit: { name: 'piece' }, units: [] },
        409,
      );
      expect(sku.code).toBe('sku_taken');
      const barcode = await createProduct(
        a.agent,
        { baseUnit: { name: 'piece', barcode: '6001234500001' }, units: [] },
        409,
      );
      expect(barcode.code).toBe('barcode_taken');

      await createProduct(b.agent, {
        sku: 'SAME-SKU',
        baseUnit: { name: 'piece', barcode: '6001234500001' },
        units: [],
      });
    });

    it.each([
      [
        'a zero conversion',
        { units: [{ name: 'box', conversion: '0' }] },
        400,
        undefined,
      ],
      [
        'a price with cents (D-021)',
        { baseUnit: { name: 'piece', retailPrice: '2500.50' } },
        400,
        undefined,
      ],
      [
        'a fractional conversion on a whole-number base unit',
        { units: [{ name: 'box', conversion: '12.5' }] },
        400,
        'conversion_not_whole',
      ],
      [
        'two units with the same name',
        { units: [{ name: 'PIECE', conversion: '2' }] },
        409,
        'unit_name_taken',
      ],
      [
        'opening stock in a unit the product does not have',
        { openingStock: { unitName: 'bag', quantity: '1' } },
        400,
        'unit_not_found',
      ],
      [
        'fractional opening stock in a whole-number unit (D-013)',
        { openingStock: { unitName: 'carton', quantity: '1.5' } },
        422,
        'fraction_not_allowed',
      ],
      ['a negative reorder level', { reorderLevel: '-1' }, 400, undefined],
    ])('rejects %s', async (_label, overrides, status, code) => {
      const owner = await ownerWithShop(app, 'invalid');
      const body = await createProduct(owner.agent, overrides, status);
      if (code) expect(body.code).toBe(code);
      expect(
        await prisma.product.count({ where: { shopId: owner.shopId } }),
      ).toBe(0);
    });

    it('allows fractions per unit: kilograms with a 50 kg bag', async () => {
      const owner = await ownerWithShop(app, 'kg');
      const rice = await createProduct(owner.agent, {
        name: 'Rice',
        baseUnit: { name: 'kg', allowFraction: true, retailPrice: '3000' },
        units: [
          {
            name: 'bag',
            conversion: '50',
            allowFraction: true,
            retailPrice: '140000',
          },
          { name: 'half kg', conversion: '0.5', retailPrice: '1600' },
        ],
        openingStock: { unitName: 'bag', quantity: '1.5' },
      });
      expect(rice.stock.quantity).toBe('75.000');
      const res = await adjust(owner.agent, {
        productId: rice.id,
        unitId: unitId(rice, 'kg'),
        kind: 'remove',
        quantity: '1.255',
        reason: 'DAMAGED',
      }).expect(201);
      expect(res.body.movement.balanceAfter).toBe('73.745');
    });
  });

  describe('search and lists', () => {
    let owner: Awaited<ReturnType<typeof ownerWithShop>>;
    let categoryId: string;

    beforeAll(async () => {
      owner = await ownerWithShop(app, 'search');
      const cat = await owner.agent
        .post('/api/v1/shops/current/product-categories')
        .send({ name: 'Cleaning' })
        .expect(201);
      categoryId = cat.body.id;
      for (const [name, sku, barcode] of [
        ['Omo washing powder 1kg', 'OMO-1', '6161100000011'],
        ['Omo washing powder 500g', 'OMO-05', '6161100000028'],
        ['Kiwi shoe polish', 'KIWI', '6161100000035'],
        ['Blue band 250g', 'BB-250', '6161100000042'],
        ['Azam cooking oil 5L', 'AZAM-5', '6161100000059'],
      ]) {
        await createProduct(owner.agent, {
          name,
          sku,
          categoryId: name.startsWith('Omo') ? categoryId : null,
          baseUnit: { name: 'piece', barcode, retailPrice: '1000' },
          units: [],
        });
      }
    });

    const search = async (query: string) =>
      (
        await owner.agent
          .get(`/api/v1/shops/current/products?${query}`)
          .expect(200)
      ).body;

    it('finds by part of the name, ignoring case', async () => {
      const res = await search('q=washing');
      expect(res.products.map((p: { name: string }) => p.name)).toEqual([
        'Omo washing powder 1kg',
        'Omo washing powder 500g',
      ]);
      expect((await search('q=POLISH')).products).toHaveLength(1);
    });

    it('finds by SKU and by barcode, saying which unit the barcode is on', async () => {
      const bySku = await search('q=kiwi');
      expect(bySku.products.map((p: { sku: string }) => p.sku)).toEqual([
        'KIWI',
      ]);
      const byBarcode = await search('q=6161100000042');
      expect(byBarcode.products).toHaveLength(1);
      expect(byBarcode.products[0].name).toBe('Blue band 250g');
      expect(byBarcode.products[0].matchedUnitId).toBe(
        byBarcode.products[0].baseUnit.id,
      );
    });

    it('treats % and _ in a search as ordinary characters', async () => {
      expect((await search('q=%25')).products).toHaveLength(0);
      expect((await search('q=_')).products).toHaveLength(0);
    });

    it('filters by category and pages with a cursor without gaps or repeats', async () => {
      expect((await search(`categoryId=${categoryId}`)).products).toHaveLength(
        2,
      );
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await search(
          `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        seen.push(...page.products.map((p: { name: string }) => p.name));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(seen).toEqual([...seen].sort());
      expect(new Set(seen).size).toBe(5);
    });

    it('rejects a tampered cursor', async () => {
      const res = await owner.agent
        .get('/api/v1/shops/current/products?cursor=not-a-cursor')
        .expect(400);
      expect(res.body.code).toBe('invalid_cursor');
    });

    it('lists categories with their product counts', async () => {
      const res = await owner.agent
        .get('/api/v1/shops/current/product-categories')
        .expect(200);
      expect(res.body.categories).toEqual([
        expect.objectContaining({ name: 'Cleaning', productCount: 2 }),
      ]);
      const dup = await owner.agent
        .post('/api/v1/shops/current/product-categories')
        .send({ name: 'cleaning' })
        .expect(409);
      expect(dup.body.code).toBe('category_name_taken');
    });
  });

  describe('editing', () => {
    it('changes prices with history and an audit entry; unchanged prices add nothing', async () => {
      const owner = await ownerWithShop(app, 'prices');
      const product = await createProduct(owner.agent);
      const carton = unitId(product, 'carton');
      const url = `/api/v1/shops/current/products/${product.id}/units/${carton}/prices`;
      const res = await owner.agent
        .put(url)
        .send({ retailPrice: '25000', wholesalePrice: null })
        .expect(200);
      const unit = res.body.units.find((u: { id: string }) => u.id === carton);
      expect(unit).toMatchObject({
        retailPrice: '25000.00',
        wholesalePrice: null,
        buyingPrice: '21600.00',
      });
      await owner.agent.put(url).send({ retailPrice: '25000' }).expect(200);
      expect(
        await prisma.priceHistory.count({ where: { productUnitId: carton } }),
      ).toBe(2);
      const audits = await prisma.auditLog.findMany({
        where: { shopId: owner.shopId, action: 'product.prices_changed' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.before).toMatchObject({ retailPrice: '24000.00' });
      expect(audits[0]!.after).toMatchObject({ retailPrice: '25000.00' });
    });

    it('updates details, adds and archives units, but never changes a conversion', async () => {
      const owner = await ownerWithShop(app, 'units');
      const product = await createProduct(owner.agent);
      const base = unitId(product, 'piece');
      const updated = await owner.agent
        .patch(`/api/v1/shops/current/products/${product.id}`)
        .send({ name: 'Bar soap 200g', sku: null, reorderLevel: '12' })
        .expect(200);
      expect(updated.body).toMatchObject({
        name: 'Bar soap 200g',
        sku: null,
        reorderLevel: '12.000',
      });

      const withDozen = await owner.agent
        .post(`/api/v1/shops/current/products/${product.id}/units`)
        .send({ name: 'dozen', conversion: '12', retailPrice: '28000' })
        .expect(201);
      const dozen = unitId(withDozen.body, 'dozen');
      const archived = await owner.agent
        .patch(`/api/v1/shops/current/products/${product.id}/units/${dozen}`)
        .send({ archived: true })
        .expect(200);
      expect(
        archived.body.units.find((u: { id: string }) => u.id === dozen)
          .archived,
      ).toBe(true);

      const baseFixed = await owner.agent
        .patch(`/api/v1/shops/current/products/${product.id}/units/${base}`)
        .send({ archived: true })
        .expect(409);
      expect(baseFixed.body.code).toBe('base_unit_fixed');
      // The update DTO has no conversion field, and the database refuses it too.
      await owner.agent
        .patch(`/api/v1/shops/current/products/${product.id}/units/${dozen}`)
        .send({ conversion: '10' })
        .expect(400);
      await expect(
        prisma.productUnit.update({
          where: { id: dozen },
          data: { conversion: '10' },
        }),
      ).rejects.toThrow(/cannot change/);
      await expect(
        prisma.productUnit.create({
          data: {
            id: '01900000-0000-7000-8000-00000000abcd',
            shopId: owner.shopId,
            productId: product.id,
            name: 'second base',
            conversion: '1',
            isBase: true,
          },
        }),
      ).rejects.toThrow(/exactly one base unit/);
    });

    it('archives only products with no stock, hides them, and restores them', async () => {
      const owner = await ownerWithShop(app, 'archive');
      const product = await createProduct(owner.agent, {
        openingStock: { unitName: 'piece', quantity: '3' },
      });
      const blocked = await owner.agent
        .post(`/api/v1/shops/current/products/${product.id}/archive`)
        .expect(409);
      expect(blocked.body.code).toBe('product_has_stock');

      await adjust(owner.agent, {
        productId: product.id,
        unitId: unitId(product, 'piece'),
        kind: 'count',
        quantity: '0',
      }).expect(201);
      await owner.agent
        .post(`/api/v1/shops/current/products/${product.id}/archive`)
        .expect(201);
      const active = await owner.agent
        .get('/api/v1/shops/current/products')
        .expect(200);
      expect(active.body.products).toHaveLength(0);
      const archived = await owner.agent
        .get('/api/v1/shops/current/products?archived=true')
        .expect(200);
      expect(archived.body.products).toHaveLength(1);

      const adjustArchived = await adjust(owner.agent, {
        productId: product.id,
        unitId: unitId(product, 'piece'),
        kind: 'add',
        quantity: '1',
      }).expect(409);
      expect(adjustArchived.body.code).toBe('product_archived');

      await owner.agent
        .post(`/api/v1/shops/current/products/${product.id}/restore`)
        .expect(201);
      expect(
        (await owner.agent.get('/api/v1/shops/current/products').expect(200))
          .body.products,
      ).toHaveLength(1);
      await expect(
        prisma.product.delete({ where: { id: product.id } }),
      ).rejects.toThrow(/cannot be changed or deleted/);
    });
  });

  describe('permissions', () => {
    it('lets a cashier look up products and stock but not change them or see costs', async () => {
      const owner = await ownerWithShop(app, 'permsowner');
      const product = await createProduct(owner.agent, {
        openingStock: { unitName: 'carton', quantity: '1', unitCost: '21600' },
      });
      const cashier = await joinWithRoles(app, owner, 'cashier', [
        await roleId(owner.agent, 'Cashier'),
      ]);
      const seen = await cashier.agent
        .get(`/api/v1/shops/current/products/${product.id}`)
        .expect(200);
      expect(seen.body.canSeeCosts).toBe(false);
      expect(seen.body.stock.quantity).toBe('12.000');
      expect(seen.body.stock.averageCost).toBeNull();
      expect(
        seen.body.units.every(
          (u: { buyingPrice: unknown }) => u.buyingPrice === null,
        ),
      ).toBe(true);
      expect(seen.body.units[0].retailPrice).toBe('2500.00');
      const movements = await cashier.agent
        .get('/api/v1/shops/current/inventory/movements')
        .expect(200);
      expect(movements.body.movements[0].unitCost).toBeNull();

      const carton = unitId(product, 'carton');
      const forbidden: [string, string, object][] = [
        ['post', '/api/v1/shops/current/products', SOAP],
        [
          'patch',
          `/api/v1/shops/current/products/${product.id}`,
          { name: 'x' },
        ],
        ['post', `/api/v1/shops/current/products/${product.id}/archive`, {}],
        [
          'post',
          `/api/v1/shops/current/products/${product.id}/units`,
          { name: 'box', conversion: '6' },
        ],
        [
          'put',
          `/api/v1/shops/current/products/${product.id}/units/${carton}/prices`,
          { retailPrice: '1' },
        ],
        ['post', '/api/v1/shops/current/product-categories', { name: 'x' }],
        [
          'post',
          `/api/v1/shops/current/products/${product.id}/opening-stock`,
          { unitId: carton, quantity: '1' },
        ],
        [
          'put',
          '/api/v1/shops/current/inventory/settings',
          { allowNegativeStock: true },
        ],
      ];
      for (const [method, url, body] of forbidden) {
        const res = await (
          cashier.agent as unknown as Record<
            string,
            (u: string) => { send(b: object): Promise<{ status: number }> }
          >
        )[method]!(url).send(body);
        expect({ url, status: res.status }).toEqual({ url, status: 403 });
      }
      const adj = await adjust(cashier.agent, {
        productId: product.id,
        unitId: carton,
        kind: 'remove',
        quantity: '1',
      }).expect(403);
      expect(adj.body.code).toBe('permission_denied');
    });

    it('lets a storekeeper add products with selling prices but not buying prices or price changes', async () => {
      const owner = await ownerWithShop(app, 'storeowner');
      const keeper = await joinWithRoles(app, owner, 'keeper', [
        await roleId(owner.agent, 'Storekeeper'),
      ]);
      const product = await createProduct(keeper.agent, {
        baseUnit: { name: 'piece', retailPrice: '2500' },
        units: [{ name: 'carton', conversion: '12', retailPrice: '24000' }],
      });
      expect(product.units[0].retailPrice).toBe('2500.00');
      const buying = await createProduct(
        keeper.agent,
        { baseUnit: { name: 'piece', buyingPrice: '1800' }, units: [] },
        403,
      );
      expect(buying.code).toBe('permission_denied');
      const opening = await createProduct(
        keeper.agent,
        { openingStock: { unitName: 'piece', quantity: '1' } },
        403,
      );
      expect(opening.code).toBe('permission_denied');
      await keeper.agent
        .put(
          `/api/v1/shops/current/products/${product.id}/units/${product.units[0].id}/prices`,
        )
        .send({ retailPrice: '1' })
        .expect(403);
    });

    it('follows a custom role exactly, including losing access when it changes', async () => {
      const owner = await ownerWithShop(app, 'customowner');
      const role = await createRole(owner, 'Price checker', ['products.read']);
      const member = await joinWithRoles(app, owner, 'checker', [role]);
      const product = await createProduct(owner.agent);
      const seen = await member.agent
        .get(`/api/v1/shops/current/products/${product.id}`)
        .expect(200);
      // products.read without inventory.read: prices but no stock.
      expect(seen.body.stock.quantity).toBeNull();
      const list = await member.agent
        .get('/api/v1/shops/current/products')
        .expect(200);
      expect(list.body.products[0].quantity).toBeNull();
      await member.agent
        .get('/api/v1/shops/current/inventory/movements')
        .expect(403);

      await owner.agent
        .put(`/api/v1/shops/current/roles/${role}`)
        .send({ name: 'Price checker', permissions: [] })
        .expect(200);
      await member.agent
        .get(`/api/v1/shops/current/products/${product.id}`)
        .expect(403);
    });
  });

  describe('tenant isolation', () => {
    it('never reads or changes another shop’s products, even with their ids', async () => {
      const alpha = await ownerWithShop(app, 'alpha');
      const beta = await ownerWithShop(app, 'beta');
      const product = await createProduct(beta.agent, {
        openingStock: { unitName: 'piece', quantity: '5' },
      });
      const base = unitId(product, 'piece');
      const cat = await beta.agent
        .post('/api/v1/shops/current/product-categories')
        .send({ name: 'Beta only' })
        .expect(201);

      const attempts: [string, string, object, number][] = [
        ['get', `/api/v1/shops/current/products/${product.id}`, {}, 404],
        [
          'patch',
          `/api/v1/shops/current/products/${product.id}`,
          { name: 'stolen' },
          404,
        ],
        [
          'post',
          `/api/v1/shops/current/products/${product.id}/archive`,
          {},
          404,
        ],
        [
          'post',
          `/api/v1/shops/current/products/${product.id}/units`,
          { name: 'box', conversion: '6' },
          404,
        ],
        [
          'patch',
          `/api/v1/shops/current/products/${product.id}/units/${base}`,
          { name: 'x' },
          404,
        ],
        [
          'put',
          `/api/v1/shops/current/products/${product.id}/units/${base}/prices`,
          { retailPrice: '1' },
          404,
        ],
        [
          'post',
          `/api/v1/shops/current/products/${product.id}/opening-stock`,
          { unitId: base, quantity: '1' },
          404,
        ],
        [
          'patch',
          `/api/v1/shops/current/product-categories/${cat.body.id}`,
          { name: 'x' },
          404,
        ],
      ];
      for (const [method, url, body, status] of attempts) {
        const res = await (
          alpha.agent as unknown as Record<
            string,
            (u: string) => { send(b: object): Promise<{ status: number }> }
          >
        )[method]!(url).send(body);
        expect({ url, status: res.status }).toEqual({ url, status });
      }
      const adj = await adjust(alpha.agent, {
        productId: product.id,
        unitId: base,
        kind: 'remove',
        quantity: '5',
      }).expect(404);
      expect(adj.body.code).toBe('product_not_found');
      // A product in alpha's own shop cannot use beta's category or units.
      const own = await createProduct(
        alpha.agent,
        { categoryId: cat.body.id },
        404,
      );
      expect(own.code).toBe('category_not_found');

      const list = await alpha.agent
        .get(
          `/api/v1/shops/current/products?q=${encodeURIComponent(product.sku)}`,
        )
        .expect(200);
      expect(list.body.products).toHaveLength(0);
      const moves = await alpha.agent
        .get(
          `/api/v1/shops/current/inventory/movements?productId=${product.id}`,
        )
        .expect(200);
      expect(moves.body.movements).toHaveLength(0);
      const cats = await alpha.agent
        .get('/api/v1/shops/current/product-categories')
        .expect(200);
      expect(cats.body.categories).toHaveLength(0);

      // Beta's data is untouched.
      const after = await stockOf(beta.agent, product.id);
      expect(after.quantity).toBe('5.000');
      expect(
        (await beta.agent.get(`/api/v1/shops/current/products/${product.id}`))
          .body.name,
      ).toBe(product.name);
    });
  });

  describe('subscription', () => {
    it('keeps a read-only shop’s products readable but refuses changes (D-005)', async () => {
      const owner = await ownerWithShop(app, 'readonly');
      const product = await createProduct(owner.agent, {
        openingStock: { unitName: 'piece', quantity: '2' },
      });
      await makeRestricted(app, owner.shopId);
      await owner.agent.get('/api/v1/shops/current/products').expect(200);
      await owner.agent
        .get(`/api/v1/shops/current/products/${product.id}`)
        .expect(200);
      await owner.agent
        .get('/api/v1/shops/current/inventory/summary')
        .expect(200);
      const create = await createProduct(owner.agent, {}, 402);
      expect(create.code).toBe('subscription_read_only');
      const adj = await adjust(owner.agent, {
        productId: product.id,
        unitId: unitId(product, 'piece'),
        kind: 'remove',
        quantity: '1',
      }).expect(402);
      expect(adj.body.code).toBe('subscription_read_only');
      await owner.agent
        .patch(`/api/v1/shops/current/products/${product.id}`)
        .send({ name: 'x' })
        .expect(402);
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('2.000');
    });

    it('enforces the plan’s product limit, counting active products only', async () => {
      const owner = await ownerWithShop(app, 'limit');
      const planId = await insertPlan(app, {
        features: [
          { featureKey: 'seats', enabled: true, limitValue: 1 },
          { featureKey: 'products', enabled: true, limitValue: 2 },
        ],
      });
      await makePaid(app, owner.shopId, planId);
      const first = await createProduct(owner.agent);
      await createProduct(owner.agent);
      const third = await createProduct(owner.agent, {}, 402);
      expect(third.code).toBe('product_limit_reached');

      await owner.agent
        .post(`/api/v1/shops/current/products/${first.id}/archive`)
        .expect(201);
      const replacement = await createProduct(owner.agent);
      expect(replacement.id).toBeDefined();
      const restore = await owner.agent
        .post(`/api/v1/shops/current/products/${first.id}/restore`)
        .expect(402);
      expect(restore.body.code).toBe('product_limit_reached');
    });

    it('applies the limit once when products are created at the same moment', async () => {
      const owner = await ownerWithShop(app, 'limitrace');
      const planId = await insertPlan(app, {
        features: [{ featureKey: 'products', enabled: true, limitValue: 3 }],
      });
      await makePaid(app, owner.shopId, planId);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          owner.agent.post('/api/v1/shops/current/products').send({
            name: 'Race',
            baseUnit: { name: 'piece' },
          }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 402)).toHaveLength(5);
      expect(
        await prisma.product.count({ where: { shopId: owner.shopId } }),
      ).toBe(3);
    });
  });
});

export type { Client };
