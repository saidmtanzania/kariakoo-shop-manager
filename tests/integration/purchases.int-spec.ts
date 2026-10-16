import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  ownerWithShop,
  resetDatabase,
  resetRateLimits,
} from './helpers/auth.js';
import { makeRestricted } from './helpers/billing.js';
import { adjust, createProduct, stockOf, unitId } from './helpers/products.js';
import {
  cancel,
  createSupplier,
  draft,
  entriesOf,
  receive,
  supplierOf,
} from './helpers/purchases.js';
import { joinWithRoles, roleId } from './helpers/team.js';

type Owner = Awaited<ReturnType<typeof ownerWithShop>>;

/**
 * Purchases (Phase 06): drafts received as the goods arrive (D-014), extra
 * costs added to the cost of goods (D-015), stock and supplier balances.
 */
describe('Purchases (Phase 06)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(() => app.close());
  beforeEach(() => resetRateLimits(app));

  /** A shop with a supplier and a product with 24 pieces at 1,800. */
  async function setup(label: string) {
    const owner = await ownerWithShop(app, label);
    const supplier = await createSupplier(owner.agent);
    const product = await createProduct(owner.agent, {
      openingStock: { unitName: 'piece', quantity: '24', unitCost: '1800' },
    });
    return {
      owner,
      supplier,
      product,
      piece: unitId(product, 'piece'),
      carton: unitId(product, 'carton'),
    };
  }

  const reconciled = async (owner: Owner) => {
    const stock = await owner.agent
      .get('/api/v1/shops/current/inventory/reconciliation')
      .expect(200);
    const suppliers = await owner.agent
      .get('/api/v1/shops/current/suppliers/reconciliation')
      .expect(200);
    expect(stock.body.mismatches).toEqual([]);
    expect(suppliers.body.mismatches).toEqual([]);
  };

  const getPurchase = async (owner: Owner, id: string) =>
    (await owner.agent.get(`/api/v1/shops/current/purchases/${id}`).expect(200))
      .body;

  describe('drafts', () => {
    it('saves a draft with line totals and extra costs, without touching stock', async () => {
      const { owner, supplier, product, piece, carton } = await setup('draft');
      const res = await draft(owner.agent, {
        supplierId: supplier.id,
        supplierReference: 'INV-77',
        lines: [
          {
            productId: product.id,
            unitId: carton,
            quantity: '2',
            unitCost: '21600',
          },
          {
            productId: product.id,
            unitId: piece,
            quantity: '3',
            unitCost: '1999',
          },
        ],
        charges: [{ description: 'Porter', amount: '1500' }],
      }).expect(201);
      expect(res.body).toMatchObject({
        number: 1,
        status: 'DRAFT',
        supplierName: supplier.name,
        supplierReference: 'INV-77',
        subtotal: '49197',
        extraCosts: '1500',
        total: '50697',
        lineCount: 2,
        receivedAt: null,
        createdByName: 'draft Tester',
        payments: [],
      });
      expect(res.body.lines).toMatchObject([
        {
          unitName: 'carton',
          quantity: '2.000',
          baseQuantity: '24.000',
          unitCost: '21600',
          lineTotal: '43200',
          allocatedExtra: '0',
          landedCostPerBase: null,
        },
        { unitName: 'piece', baseQuantity: '3.000', lineTotal: '5997' },
      ]);
      expect(res.body.charges).toMatchObject([
        { description: 'Porter', amount: '1500' },
      ]);
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('24.000');
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe('0');

      const second = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '1',
          },
        ],
      }).expect(201);
      expect(second.body.number).toBe(2);
      const list = await owner.agent
        .get('/api/v1/shops/current/purchases?status=DRAFT')
        .expect(200);
      expect(
        list.body.purchases.map((p: { number: number }) => p.number),
      ).toEqual([2, 1]);
    });

    it('replays a retried draft and refuses a changed one with the same key', async () => {
      const { owner, supplier, product, piece } = await setup('draftretry');
      const body = {
        supplierId: supplier.id,
        idempotencyKey: 'draft-key-1',
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '5',
            unitCost: '1800',
          },
        ],
      };
      const results = await Promise.all(
        Array.from({ length: 4 }, () => draft(owner.agent, body)),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      const changed = await draft(owner.agent, {
        ...body,
        lines: [{ ...body.lines[0]!, quantity: '6' }],
      }).expect(409);
      expect(changed.body.code).toBe('idempotency_conflict');
      expect(
        await prisma.purchase.count({ where: { shopId: owner.shopId } }),
      ).toBe(1);
    });

    it('refuses invalid quantities, costs and units', async () => {
      const { owner, supplier, product, piece } = await setup('draftinvalid');
      const line = { productId: product.id, unitId: piece, unitCost: '100' };
      for (const quantity of ['0', '-1', 'abc', '1.0001']) {
        await draft(owner.agent, {
          supplierId: supplier.id,
          lines: [{ ...line, quantity }],
        }).expect(400);
      }
      for (const unitCost of ['-1', '10.5']) {
        await draft(owner.agent, {
          supplierId: supplier.id,
          lines: [{ ...line, quantity: '1', unitCost }],
        }).expect(400);
      }
      await draft(owner.agent, { supplierId: supplier.id, lines: [] }).expect(
        400,
      );
      const fraction = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [{ ...line, quantity: '1.5' }],
      }).expect(422);
      expect(fraction.body.code).toBe('fraction_not_allowed');
      const other = await createProduct(owner.agent);
      const wrongUnit = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [{ ...line, unitId: unitId(other, 'piece'), quantity: '1' }],
      }).expect(404);
      expect(wrongUnit.body.code).toBe('unit_not_found');
      const noValue = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [{ ...line, quantity: '1', unitCost: '0' }],
        charges: [{ description: 'Transport', amount: '500' }],
      }).expect(422);
      expect(noValue.body.code).toBe('charges_need_value');
      expect(
        await prisma.purchase.count({ where: { shopId: owner.shopId } }),
      ).toBe(0);
    });

    it('edits only drafts', async () => {
      const { owner, supplier, product, piece } = await setup('draftedit');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '100',
          },
        ],
      }).expect(201);
      const url = `/api/v1/shops/current/purchases/${created.body.id}`;
      const other = await createSupplier(owner.agent);
      const edited = await owner.agent
        .put(url)
        .send({
          supplierId: other.id,
          lines: [
            {
              productId: product.id,
              unitId: piece,
              quantity: '4',
              unitCost: '250',
            },
          ],
          charges: [{ description: 'Boda', amount: '300' }],
        })
        .expect(200);
      expect(edited.body).toMatchObject({
        supplierId: other.id,
        subtotal: '1000',
        extraCosts: '300',
        total: '1300',
      });
      expect(edited.body.lines).toHaveLength(1);
      await receive(owner.agent, created.body.id).expect(200);
      const late = await owner.agent
        .put(url)
        .send({
          supplierId: other.id,
          lines: [
            {
              productId: product.id,
              unitId: piece,
              quantity: '9',
              unitCost: '1',
            },
          ],
          charges: [],
        })
        .expect(409);
      expect(late.body.code).toBe('purchase_not_draft');
    });

    it('needs an active supplier', async () => {
      const { owner, product, piece } = await setup('draftsupplier');
      const archived = await createSupplier(owner.agent);
      await owner.agent
        .patch(`/api/v1/shops/current/suppliers/${archived.id}`)
        .send({ archived: true })
        .expect(200);
      const lines = [
        { productId: product.id, unitId: piece, quantity: '1', unitCost: '1' },
      ];
      const res = await draft(owner.agent, {
        supplierId: archived.id,
        lines,
      }).expect(409);
      expect(res.body.code).toBe('supplier_archived');
    });
  });

  describe('receiving', () => {
    it('adds stock at the landed cost and charges the supplier (D-015, D-003)', async () => {
      const { owner, supplier, product, carton } = await setup('receive');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: carton,
            quantity: '2',
            unitCost: '21600',
          },
        ],
        charges: [{ description: 'Transport', amount: '1200' }],
      }).expect(201);
      const received = await receive(owner.agent, created.body.id).expect(200);
      expect(received.body).toMatchObject({
        status: 'RECEIVED',
        total: '44400',
        receivedByName: 'receive Tester',
      });
      expect(received.body.lines[0]).toMatchObject({
        allocatedExtra: '1200',
        // (43,200 + 1,200) / 24 pieces
        landedCostPerBase: '1850.0000',
      });
      // 24 at 1,800 and 24 at 1,850 → 1,825.
      expect(await stockOf(owner.agent, product.id)).toMatchObject({
        quantity: '48.000',
        averageCost: '1825.0000',
      });
      const history = await owner.agent
        .get(
          `/api/v1/shops/current/inventory/movements?productId=${product.id}`,
        )
        .expect(200);
      expect(history.body.movements[0]).toMatchObject({
        type: 'PURCHASE_RECEIPT',
        quantity: '24.000',
        balanceAfter: '48.000',
        unitName: 'carton',
        unitQuantity: '2.000',
        unitCost: '1850.0000',
        purchaseId: created.body.id,
      });
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe(
        '44400',
      );
      expect(await entriesOf(owner.agent, supplier.id)).toMatchObject([
        {
          type: 'PURCHASE',
          amount: '44400',
          balanceAfter: '44400',
          purchaseNumber: 1,
        },
      ]);
      const audit = await prisma.auditLog.findFirst({
        where: { shopId: owner.shopId, action: 'purchase.received' },
      });
      expect(audit?.after).toMatchObject({
        total: '44400',
        extraCosts: '1200',
      });
      await reconciled(owner);
    });

    it('spreads extra costs by value in whole shillings', async () => {
      const { owner, supplier, product, carton } = await setup('spread');
      const second = await createProduct(owner.agent);
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: carton,
            quantity: '2',
            unitCost: '21600',
          },
          {
            productId: second.id,
            unitId: unitId(second, 'piece'),
            quantity: '10',
            unitCost: '1900',
          },
        ],
        charges: [
          { description: 'Transport', amount: '700' },
          { description: 'Porter', amount: '300' },
        ],
      }).expect(201);
      const received = await receive(owner.agent, created.body.id).expect(200);
      // 1,000 over 43,200 and 19,000: 694.53 and 305.47 → 695 and 305.
      expect(received.body.lines).toMatchObject([
        { allocatedExtra: '695', landedCostPerBase: '1828.9583' },
        { allocatedExtra: '305', landedCostPerBase: '1930.5000' },
      ]);
      expect(await stockOf(owner.agent, second.id)).toMatchObject({
        quantity: '10.000',
        averageCost: '1930.5000',
      });
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe(
        '63200',
      );
      await reconciled(owner);
    });

    it('receives once however many times it is sent, even at the same time', async () => {
      const { owner, supplier, product, piece } = await setup('receiveonce');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '6',
            unitCost: '1800',
          },
        ],
      }).expect(201);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => receive(owner.agent, created.body.id)),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      await receive(owner.agent, created.body.id).expect(200);
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('30.000');
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe(
        '10800',
      );
      expect(
        await prisma.stockMovement.count({
          where: { purchaseId: created.body.id },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { shopId: owner.shopId, action: 'purchase.received' },
        }),
      ).toBe(1);
      await reconciled(owner);
    });

    it('applies two purchases of the same products at once without losing stock', async () => {
      const { owner, supplier, product, piece } = await setup('receiveboth');
      const second = await createProduct(owner.agent);
      const ids = await Promise.all(
        [
          [product.id, piece, second.id, unitId(second, 'piece')],
          [second.id, unitId(second, 'piece'), product.id, piece],
        ].map(async ([p1, u1, p2, u2]) => {
          const res = await draft(owner.agent, {
            supplierId: supplier.id,
            lines: [
              { productId: p1!, unitId: u1!, quantity: '5', unitCost: '100' },
              { productId: p2!, unitId: u2!, quantity: '5', unitCost: '100' },
            ],
          }).expect(201);
          return res.body.id as string;
        }),
      );
      const results = await Promise.all(
        ids.map((id) => receive(owner.agent, id)),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('34.000');
      expect((await stockOf(owner.agent, second.id)).quantity).toBe('10.000');
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe('2000');
      await reconciled(owner);
    });

    it('records a payment made on arrival, and never more than is owed', async () => {
      const { owner, supplier, product, piece } = await setup('receivepay');
      const lines = [
        {
          productId: product.id,
          unitId: piece,
          quantity: '10',
          unitCost: '1000',
        },
      ];
      const tooMuch = await draft(owner.agent, {
        supplierId: supplier.id,
        lines,
      }).expect(201);
      const refused = await receive(owner.agent, tooMuch.body.id, {
        payment: { amount: '10001', method: 'CASH' },
      }).expect(409);
      expect(refused.body.code).toBe('payment_exceeds_balance');
      // Nothing was received.
      expect((await getPurchase(owner, tooMuch.body.id)).status).toBe('DRAFT');
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('24.000');
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe('0');

      const received = await receive(owner.agent, tooMuch.body.id, {
        payment: { amount: '4000', method: 'MOBILE_MONEY', reference: 'TX9' },
      }).expect(200);
      expect(received.body.payments).toMatchObject([
        { amount: '4000', method: 'MOBILE_MONEY', reference: 'TX9' },
      ]);
      // A retry with the payment does not pay twice.
      await receive(owner.agent, tooMuch.body.id, {
        payment: { amount: '4000', method: 'MOBILE_MONEY', reference: 'TX9' },
      }).expect(200);
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe('6000');
      expect(await entriesOf(owner.agent, supplier.id)).toMatchObject([
        { type: 'PAYMENT', amount: '-4000', balanceAfter: '6000' },
        { type: 'PURCHASE', amount: '10000', balanceAfter: '10000' },
      ]);
      await reconciled(owner);
    });

    it('refuses goods for a product archived since the draft', async () => {
      const { owner, supplier } = await setup('receivearchived');
      // A product without stock can be archived.
      const product = await createProduct(owner.agent);
      const piece = unitId(product, 'piece');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '1',
          },
        ],
      }).expect(201);
      await owner.agent
        .post(`/api/v1/shops/current/products/${product.id}/archive`)
        .expect(201);
      const res = await receive(owner.agent, created.body.id).expect(409);
      expect(res.body.code).toBe('product_archived');
      expect((await getPurchase(owner, created.body.id)).status).toBe('DRAFT');
    });
  });

  describe('cancelling', () => {
    it('reverses stock, cost and the supplier charge of a received purchase', async () => {
      const { owner, supplier, product, carton } = await setup('cancel');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: carton,
            quantity: '2',
            unitCost: '21600',
          },
        ],
        charges: [{ description: 'Transport', amount: '1200' }],
      }).expect(201);
      await receive(owner.agent, created.body.id, {
        payment: { amount: '4400', method: 'CASH' },
      }).expect(200);
      await cancel(owner.agent, created.body.id, 'x').expect(400);
      const cancelled = await cancel(
        owner.agent,
        created.body.id,
        'Supplier took the goods back',
      ).expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Supplier took the goods back',
        cancelledByName: 'cancel Tester',
      });
      expect(await stockOf(owner.agent, product.id)).toMatchObject({
        quantity: '24.000',
        averageCost: '1800.0000',
      });
      const history = await owner.agent
        .get(
          `/api/v1/shops/current/inventory/movements?productId=${product.id}`,
        )
        .expect(200);
      expect(history.body.movements[0]).toMatchObject({
        type: 'PURCHASE_REVERSAL',
        quantity: '-24.000',
        unitCost: '1850.0000',
        purchaseId: created.body.id,
        note: 'Supplier took the goods back',
      });
      // The 4,400 paid stays recorded, so the supplier now owes the shop.
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe(
        '-4400',
      );
      expect((await entriesOf(owner.agent, supplier.id))[0]).toMatchObject({
        type: 'PURCHASE_CANCELLED',
        amount: '-44400',
        balanceAfter: '-4400',
      });

      // Cancelling again changes nothing; receiving again is refused.
      await cancel(owner.agent, created.body.id).expect(200);
      const again = await receive(owner.agent, created.body.id).expect(409);
      expect(again.body.code).toBe('purchase_cancelled');
      expect(
        await prisma.stockMovement.count({
          where: { purchaseId: created.body.id },
        }),
      ).toBe(2);
      expect(
        await prisma.auditLog.count({
          where: { shopId: owner.shopId, action: 'purchase.cancelled' },
        }),
      ).toBe(1);
      await reconciled(owner);
    });

    it('refuses to cancel when the goods have already been used', async () => {
      const { owner, supplier, product, piece } = await setup('cancelused');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '10',
            unitCost: '1000',
          },
        ],
      }).expect(201);
      await receive(owner.agent, created.body.id).expect(200);
      await adjust(owner.agent, {
        productId: product.id,
        unitId: piece,
        kind: 'remove',
        quantity: '30',
        reason: 'DAMAGED',
      }).expect(201);
      const res = await cancel(owner.agent, created.body.id).expect(409);
      expect(res.body.code).toBe('insufficient_stock');
      expect((await getPurchase(owner, created.body.id)).status).toBe(
        'RECEIVED',
      );
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('4.000');
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe(
        '10000',
      );
      await reconciled(owner);
    });

    it('cancels a draft without touching stock or the supplier', async () => {
      const { owner, supplier, product, piece } = await setup('canceldraft');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '1',
          },
        ],
      }).expect(201);
      await cancel(owner.agent, created.body.id).expect(200);
      expect(
        await prisma.stockMovement.count({
          where: { purchaseId: created.body.id },
        }),
      ).toBe(0);
      expect(await entriesOf(owner.agent, supplier.id)).toEqual([]);
    });

    it('ends cancelled and balanced when cancel and receive race', async () => {
      const { owner, supplier, product, piece } = await setup('cancelrace');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '3',
            unitCost: '10',
          },
        ],
      }).expect(201);
      const [cancelled, received] = await Promise.all([
        cancel(owner.agent, created.body.id),
        receive(owner.agent, created.body.id),
      ]);
      expect(cancelled.status).toBe(200);
      // Received first (then reversed by the cancel), or refused after it.
      expect([200, 409]).toContain(received.status);
      expect((await getPurchase(owner, created.body.id)).status).toBe(
        'CANCELLED',
      );
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('24.000');
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe('0');
      await reconciled(owner);
    });
  });

  describe('access', () => {
    it('lets a storekeeper receive goods but not see costs, create, pay or cancel', async () => {
      const { owner, supplier, product, piece } = await setup('keeper');
      const keeper = await joinWithRoles(app, owner, 'keeper', [
        await roleId(owner.agent, 'Storekeeper'),
      ]);
      const lines = [
        {
          productId: product.id,
          unitId: piece,
          quantity: '2',
          unitCost: '900',
        },
      ];
      const refused = await draft(keeper.agent, {
        supplierId: supplier.id,
        lines,
      }).expect(403);
      expect(refused.body.code).toBe('permission_denied');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines,
      }).expect(201);
      const seen = await keeper.agent
        .get(`/api/v1/shops/current/purchases/${created.body.id}`)
        .expect(200);
      expect(seen.body).toMatchObject({
        total: null,
        subtotal: null,
        extraCosts: null,
      });
      expect(seen.body.lines[0]).toMatchObject({
        quantity: '2.000',
        unitCost: null,
        lineTotal: null,
      });
      const listed = await keeper.agent
        .get('/api/v1/shops/current/purchases')
        .expect(200);
      expect(listed.body.purchases[0].total).toBeNull();

      const withPayment = await receive(keeper.agent, created.body.id, {
        payment: { amount: '100', method: 'CASH' },
      }).expect(403);
      expect(withPayment.body.code).toBe('permission_denied');
      await receive(keeper.agent, created.body.id).expect(200);
      expect((await stockOf(owner.agent, product.id)).quantity).toBe('26.000');
      await cancel(keeper.agent, created.body.id).expect(403);
    });

    it('a custom role with purchases but without costs cannot enter a purchase', async () => {
      const { owner, supplier, product, piece } = await setup('nocosts');
      const res = await owner.agent
        .post('/api/v1/shops/current/roles')
        .send({
          name: 'Buyer',
          permissions: ['purchases.read', 'purchases.create', 'suppliers.read'],
        })
        .expect(201);
      const buyer = await joinWithRoles(app, owner, 'buyer', [res.body.id]);
      const refused = await draft(buyer.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '1',
          },
        ],
      }).expect(403);
      expect(refused.body.code).toBe('permission_denied');
    });

    it('keeps cashiers out of purchases', async () => {
      const { owner } = await setup('pcashier');
      const cashier = await joinWithRoles(app, owner, 'cashier', [
        await roleId(owner.agent, 'Cashier'),
      ]);
      await cashier.agent.get('/api/v1/shops/current/purchases').expect(403);
    });

    it("never shows, receives or cancels another shop's purchase", async () => {
      const { owner, supplier, product, piece } = await setup('ptenant');
      const intruder = await ownerWithShop(app, 'pintruder');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '1',
          },
        ],
      }).expect(201);
      const url = `/api/v1/shops/current/purchases/${created.body.id}`;
      for (const res of [
        await intruder.agent.get(url),
        await intruder.agent.put(url).send({
          supplierId: supplier.id,
          lines: [
            {
              productId: product.id,
              unitId: piece,
              quantity: '1',
              unitCost: '1',
            },
          ],
          charges: [],
        }),
        await receive(intruder.agent, created.body.id),
        await cancel(intruder.agent, created.body.id),
      ]) {
        expect(res.status).toBe(404);
      }
      const list = await intruder.agent
        .get('/api/v1/shops/current/purchases')
        .expect(200);
      expect(list.body.purchases).toEqual([]);

      // Another shop's supplier or product cannot be used in a purchase.
      const ownSupplier = await createSupplier(intruder.agent);
      const ownProduct = await createProduct(intruder.agent);
      const theirSupplier = await draft(intruder.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: ownProduct.id,
            unitId: unitId(ownProduct, 'piece'),
            quantity: '1',
            unitCost: '1',
          },
        ],
      }).expect(404);
      expect(theirSupplier.body.code).toBe('supplier_not_found');
      const theirProduct = await draft(intruder.agent, {
        supplierId: ownSupplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '1',
          },
        ],
      }).expect(404);
      expect(theirProduct.body.code).toBe('product_not_found');
      expect((await getPurchase(owner, created.body.id)).status).toBe('DRAFT');
    });

    it('needs a writable subscription to create, receive or cancel', async () => {
      const { owner, supplier, product, piece } = await setup('preadonly');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '1',
          },
        ],
      }).expect(201);
      await makeRestricted(app, owner.shopId);
      await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '1',
          },
        ],
      }).expect(402);
      await receive(owner.agent, created.body.id).expect(402);
      await cancel(owner.agent, created.body.id).expect(402);
      await owner.agent.get('/api/v1/shops/current/purchases').expect(200);
    });
  });

  describe('database guards', () => {
    it('freezes received purchases and their lines', async () => {
      const { owner, supplier, product, piece } = await setup('pguards');
      const created = await draft(owner.agent, {
        supplierId: supplier.id,
        lines: [
          {
            productId: product.id,
            unitId: piece,
            quantity: '1',
            unitCost: '5',
          },
        ],
      }).expect(201);
      await receive(owner.agent, created.body.id).expect(200);
      const id = created.body.id as string;
      await expect(
        prisma.purchaseLine.updateMany({
          where: { purchaseId: id },
          data: { unitCost: '1' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.purchaseLine.deleteMany({ where: { purchaseId: id } }),
      ).rejects.toThrow();
      await expect(
        prisma.purchase.update({ where: { id }, data: { total: '1' } }),
      ).rejects.toThrow();
      await expect(
        prisma.purchase.update({ where: { id }, data: { status: 'DRAFT' } }),
      ).rejects.toThrow();
      await expect(prisma.purchase.delete({ where: { id } })).rejects.toThrow();
    });
  });
});
