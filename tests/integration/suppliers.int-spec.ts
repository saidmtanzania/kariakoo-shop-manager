import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  ownerWithShop,
  resetDatabase,
  resetRateLimits,
} from './helpers/auth.js';
import { makeRestricted } from './helpers/billing.js';
import {
  createSupplier,
  entriesOf,
  pay,
  supplierOf,
} from './helpers/purchases.js';
import { joinWithRoles, roleId } from './helpers/team.js';

type Owner = Awaited<ReturnType<typeof ownerWithShop>>;

/** Suppliers, the supplier ledger and payments to suppliers (Phase 06). */
describe('Suppliers (Phase 06)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(() => app.close());
  beforeEach(() => resetRateLimits(app));

  const reconciliation = async (owner: Owner) =>
    (
      await owner.agent
        .get('/api/v1/shops/current/suppliers/reconciliation')
        .expect(200)
    ).body;

  describe('records', () => {
    it('adds a supplier with an opening balance as its first ledger entry', async () => {
      const owner = await ownerWithShop(app, 'supplier');
      const supplier = await createSupplier(owner.agent, {
        name: '  Mzee Wholesale ',
        phone: '0712 000 000',
        openingBalance: '50000',
      });
      expect(supplier).toMatchObject({
        name: 'Mzee Wholesale',
        phone: '0712 000 000',
        address: null,
        balance: '50000',
        archived: false,
      });
      expect(await entriesOf(owner.agent, supplier.id)).toMatchObject([
        { type: 'OPENING_BALANCE', amount: '50000', balanceAfter: '50000' },
      ]);

      const plain = await createSupplier(owner.agent, { name: 'No balance' });
      expect(plain.balance).toBe('0');
      expect(await entriesOf(owner.agent, plain.id)).toEqual([]);

      const audit = await prisma.auditLog.findFirst({
        where: { shopId: owner.shopId, action: 'supplier.created' },
      });
      expect(audit?.entityId).toBe(supplier.id);
      expect((await reconciliation(owner)).mismatches).toEqual([]);
    });

    it('refuses a second supplier with the same name, ignoring case', async () => {
      const owner = await ownerWithShop(app, 'dupname');
      await createSupplier(owner.agent, { name: 'Juma Traders' });
      const res = await createSupplier(
        owner.agent,
        { name: 'JUMA traders' },
        409,
      );
      expect(res.code).toBe('supplier_name_taken');
      // Another shop may use the same name.
      const other = await ownerWithShop(app, 'dupname2');
      await createSupplier(other.agent, { name: 'Juma Traders' });
    });

    it('validates input', async () => {
      const owner = await ownerWithShop(app, 'supvalid');
      await createSupplier(owner.agent, { name: '' }, 400);
      await createSupplier(owner.agent, { openingBalance: '-5' }, 400);
      await createSupplier(owner.agent, { openingBalance: '10.50' }, 400);
      await createSupplier(owner.agent, { name: 'x'.repeat(121) }, 400);
    });

    it('lists and searches suppliers with paging', async () => {
      const owner = await ownerWithShop(app, 'suplist');
      for (const name of ['Alpha', 'Bravo', 'Charlie']) {
        await createSupplier(owner.agent, { name });
      }
      const first = await owner.agent
        .get('/api/v1/shops/current/suppliers?limit=2')
        .expect(200);
      expect(first.body.suppliers.map((s: { name: string }) => s.name)).toEqual(
        ['Alpha', 'Bravo'],
      );
      const next = await owner.agent
        .get(
          `/api/v1/shops/current/suppliers?limit=2&cursor=${first.body.nextCursor}`,
        )
        .expect(200);
      expect(next.body.suppliers.map((s: { name: string }) => s.name)).toEqual([
        'Charlie',
      ]);
      expect(next.body.nextCursor).toBeNull();
      const found = await owner.agent
        .get('/api/v1/shops/current/suppliers?q=brav')
        .expect(200);
      expect(found.body.suppliers).toHaveLength(1);
    });

    it('archives a supplier only when nothing is owed either way', async () => {
      const owner = await ownerWithShop(app, 'archive');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '1000',
      });
      const url = `/api/v1/shops/current/suppliers/${supplier.id}`;
      const refused = await owner.agent
        .patch(url)
        .send({ archived: true })
        .expect(409);
      expect(refused.body.code).toBe('supplier_has_balance');
      await pay(owner.agent, supplier.id, { amount: '1000' }).expect(201);
      const archived = await owner.agent
        .patch(url)
        .send({ archived: true, phone: '0700' })
        .expect(200);
      expect(archived.body).toMatchObject({ archived: true, phone: '0700' });
      const listed = await owner.agent
        .get('/api/v1/shops/current/suppliers')
        .expect(200);
      expect(listed.body.suppliers).toEqual([]);
      const withArchived = await owner.agent
        .get('/api/v1/shops/current/suppliers?archived=true')
        .expect(200);
      expect(withArchived.body.suppliers).toHaveLength(1);
      await owner.agent.patch(url).send({ archived: false }).expect(200);
    });
  });

  describe('payments', () => {
    it('reduces the balance, replays retries and refuses a changed retry', async () => {
      const owner = await ownerWithShop(app, 'payment');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '50000',
      });
      const key = 'pay-retry-1';
      const first = await pay(owner.agent, supplier.id, {
        amount: '20000',
        method: 'MOBILE_MONEY',
        reference: 'MP123',
        idempotencyKey: key,
      }).expect(201);
      expect(first.body).toMatchObject({
        amount: '20000',
        method: 'MOBILE_MONEY',
        reference: 'MP123',
        reversed: false,
        actorName: 'payment Tester',
      });
      const again = await pay(owner.agent, supplier.id, {
        amount: '20000',
        method: 'MOBILE_MONEY',
        reference: 'MP123',
        idempotencyKey: key,
      }).expect(201);
      expect(again.body.id).toBe(first.body.id);
      const changed = await pay(owner.agent, supplier.id, {
        amount: '25000',
        method: 'MOBILE_MONEY',
        idempotencyKey: key,
      }).expect(409);
      expect(changed.body.code).toBe('idempotency_conflict');

      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe(
        '30000',
      );
      expect(await entriesOf(owner.agent, supplier.id)).toMatchObject([
        { type: 'PAYMENT', amount: '-20000', balanceAfter: '30000' },
        { type: 'OPENING_BALANCE', amount: '50000', balanceAfter: '50000' },
      ]);
      expect(
        await prisma.auditLog.count({
          where: { shopId: owner.shopId, action: 'supplier.payment_recorded' },
        }),
      ).toBe(1);
    });

    it('records one payment when the same request arrives at once', async () => {
      const owner = await ownerWithShop(app, 'paysame');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '9000',
      });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          pay(owner.agent, supplier.id, {
            amount: '1000',
            idempotencyKey: 'same-key',
          }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe('8000');
    });

    it('never pays more than is owed, even with payments at the same time', async () => {
      const owner = await ownerWithShop(app, 'overpay');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '5000',
      });
      const tooMuch = await pay(owner.agent, supplier.id, {
        amount: '5001',
      }).expect(409);
      expect(tooMuch.body.code).toBe('payment_exceeds_balance');
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          pay(owner.agent, supplier.id, { amount: '2000' }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe('1000');
      expect((await reconciliation(owner)).mismatches).toEqual([]);
    });

    it('validates amounts', async () => {
      const owner = await ownerWithShop(app, 'payvalid');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '5000',
      });
      for (const amount of ['0', '-100', '10.5', 'abc']) {
        await pay(owner.agent, supplier.id, { amount }).expect(400);
      }
      await pay(owner.agent, supplier.id, {
        amount: '100',
        method: 'CHEQUE',
      }).expect(400);
    });

    it('reverses a payment once, restoring the balance', async () => {
      const owner = await ownerWithShop(app, 'reverse');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '10000',
      });
      const payment = await pay(owner.agent, supplier.id, {
        amount: '4000',
      }).expect(201);
      const url = `/api/v1/shops/current/suppliers/${supplier.id}/payments/${payment.body.id}/reverse`;
      await owner.agent.post(url).send({ reason: 'x' }).expect(400);
      const reversed = await owner.agent
        .post(url)
        .send({ reason: 'Entered twice' })
        .expect(200);
      expect(reversed.body).toMatchObject({
        reversed: true,
        reverseReason: 'Entered twice',
      });
      await owner.agent.post(url).send({ reason: 'Again' }).expect(200);
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe(
        '10000',
      );
      const entries = await entriesOf(owner.agent, supplier.id);
      expect(entries).toMatchObject([
        { type: 'PAYMENT_REVERSED', amount: '4000', balanceAfter: '10000' },
        { type: 'PAYMENT', amount: '-4000', paymentReversed: true },
        { type: 'OPENING_BALANCE' },
      ]);
      expect(
        await prisma.auditLog.count({
          where: { shopId: owner.shopId, action: 'supplier.payment_reversed' },
        }),
      ).toBe(1);
      // A payment id from the wrong supplier is not found.
      const other = await createSupplier(owner.agent);
      const wrong = await owner.agent
        .post(
          `/api/v1/shops/current/suppliers/${other.id}/payments/${payment.body.id}/reverse`,
        )
        .send({ reason: 'Wrong supplier' })
        .expect(404);
      expect(wrong.body.code).toBe('supplier_payment_not_found');
    });
  });

  describe('access', () => {
    it('lets a storekeeper see suppliers without amounts, and keeps cashiers out', async () => {
      const owner = await ownerWithShop(app, 'supaccess');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '7000',
      });
      const keeper = await joinWithRoles(app, owner, 'keeper', [
        await roleId(owner.agent, 'Storekeeper'),
      ]);
      const cashier = await joinWithRoles(app, owner, 'cashier', [
        await roleId(owner.agent, 'Cashier'),
      ]);
      const seen = await supplierOf(keeper.agent, supplier.id);
      expect(seen).toMatchObject({ name: supplier.name, balance: null });
      expect(await entriesOf(keeper.agent, supplier.id)).toMatchObject([
        { type: 'OPENING_BALANCE', amount: null, balanceAfter: null },
      ]);
      await createSupplier(keeper.agent, {}, 403);
      await pay(keeper.agent, supplier.id, { amount: '100' }).expect(403);
      await cashier.agent.get('/api/v1/shops/current/suppliers').expect(403);
      await cashier.agent
        .get(`/api/v1/shops/current/suppliers/${supplier.id}`)
        .expect(403);
    });

    it("never shows or changes another shop's supplier", async () => {
      const owner = await ownerWithShop(app, 'suptenant');
      const intruder = await ownerWithShop(app, 'supintruder');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '3000',
      });
      const payment = await pay(owner.agent, supplier.id, {
        amount: '1000',
      }).expect(201);
      const base = `/api/v1/shops/current/suppliers/${supplier.id}`;
      for (const res of [
        await intruder.agent.get(base),
        await intruder.agent.get(`${base}/entries`),
        await intruder.agent.patch(base).send({ name: 'Mine now' }),
        await pay(intruder.agent, supplier.id, { amount: '100' }),
        await intruder.agent
          .post(`${base}/payments/${payment.body.id}/reverse`)
          .send({ reason: 'Stealing' }),
      ]) {
        expect(res.status).toBe(404);
      }
      const list = await intruder.agent
        .get('/api/v1/shops/current/suppliers')
        .expect(200);
      expect(list.body.suppliers).toEqual([]);
      // A client-supplied shop id is ignored.
      await intruder.agent
        .get(`${base}?shopId=${owner.shopId}`)
        .set('X-Shop-Id', owner.shopId)
        .expect(404);
      expect((await supplierOf(owner.agent, supplier.id)).balance).toBe('2000');
    });

    it('keeps payments working in a read-only shop but not supplier changes', async () => {
      const owner = await ownerWithShop(app, 'supreadonly');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '3000',
      });
      await makeRestricted(app, owner.shopId);
      const added = await createSupplier(owner.agent, {}, 402);
      expect(added.code).toBe('subscription_read_only');
      await owner.agent
        .patch(`/api/v1/shops/current/suppliers/${supplier.id}`)
        .send({ name: 'Renamed' })
        .expect(402);
      const payment = await pay(owner.agent, supplier.id, {
        amount: '1000',
      }).expect(201);
      await owner.agent
        .post(
          `/api/v1/shops/current/suppliers/${supplier.id}/payments/${payment.body.id}/reverse`,
        )
        .send({ reason: 'Mistake' })
        .expect(200);
      await owner.agent.get('/api/v1/shops/current/suppliers').expect(200);
    });
  });

  describe('database guards', () => {
    it('keeps the ledger append-only and suppliers undeletable', async () => {
      const owner = await ownerWithShop(app, 'supguards');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '3000',
      });
      const payment = await pay(owner.agent, supplier.id, {
        amount: '1000',
      }).expect(201);
      await expect(
        prisma.supplierLedgerEntry.updateMany({
          where: { supplierId: supplier.id },
          data: { amount: '1' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.supplierLedgerEntry.deleteMany({
          where: { supplierId: supplier.id },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.supplier.delete({ where: { id: supplier.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.supplierPayment.update({
          where: { id: payment.body.id },
          data: { amount: '1' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.supplierPayment.delete({ where: { id: payment.body.id } }),
      ).rejects.toThrow();
    });

    it('reports a balance that no longer matches its ledger', async () => {
      const owner = await ownerWithShop(app, 'supmismatch');
      const supplier = await createSupplier(owner.agent, {
        openingBalance: '3000',
      });
      await prisma.$executeRaw`UPDATE suppliers SET balance = 2999 WHERE id = ${supplier.id}::uuid`;
      expect((await reconciliation(owner)).mismatches).toEqual([
        {
          supplierId: supplier.id,
          supplierName: supplier.name,
          balance: '2999',
          ledgerTotal: '3000',
        },
      ]);
    });
  });
});
