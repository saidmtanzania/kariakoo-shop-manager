import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { createTestApp } from './helpers/app.js';
import { ownerWithShop, resetDatabase } from './helpers/auth.js';

const PRODUCTS = 10_000;
const ROUNDS = 20;

/**
 * NFR-1 (an assumed target still to be confirmed): product search p95 under
 * 300 ms server time with 10,000 products in a shop. Measured through the
 * full HTTP stack on the test machine against a real PostgreSQL.
 */
describe('Product search with 10,000 products (NFR-1)', () => {
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof ownerWithShop>>;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    owner = await ownerWithShop(app, 'volume');
    // Generated test products, inserted in bulk (not real business data).
    await app.get(PrismaService).$executeRawUnsafe(`
      WITH p AS (
        INSERT INTO products (id, shop_id, name, sku, created_at, updated_at)
        SELECT gen_random_uuid(), '${owner.shopId}',
               'Test product ' || g || ' ' || (ARRAY['soap','rice','sugar','oil','flour','tea','salt','beans'])[1 + g % 8],
               'SKU-' || g, now(), now()
        FROM generate_series(1, ${PRODUCTS}) g
        RETURNING id, sku
      )
      INSERT INTO product_units (id, shop_id, product_id, name, conversion, is_base, barcode, retail_price, created_at, updated_at)
      SELECT gen_random_uuid(), '${owner.shopId}', p.id, 'piece', 1, true,
             '600' || lpad(substr(p.sku::text, 5), 10, '0'), 1000, now(), now()
      FROM p`);
    await app
      .get(PrismaService)
      .$executeRawUnsafe('ANALYZE products; ANALYZE product_units');
  }, 120_000);
  afterAll(() => app.close());

  async function p95(query: string): Promise<{ p95: number; count: number }> {
    const times: number[] = [];
    let count = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const start = performance.now();
      const res = await owner.agent
        .get(`/api/v1/shops/current/products?${query}`)
        .expect(200);
      times.push(performance.now() - start);
      count = res.body.products.length;
    }
    times.sort((a, b) => a - b);
    return { p95: times[Math.ceil(ROUNDS * 0.95) - 1]!, count };
  }

  it.each([
    ['part of a name', 'q=sugar&limit=20', 20],
    ['a rare name fragment', 'q=product%209999%20', 1],
    ['an exact SKU', 'q=SKU-4321', 1],
    ['a barcode', 'q=6000000007777', 1],
    ['the first page of all products', 'limit=50', 50],
  ])('searches by %s within 300 ms (p95)', async (_label, query, expected) => {
    const result = await p95(query);
    process.stderr.write(`search ${query}: p95 ${result.p95.toFixed(1)} ms\n`);
    expect(result.count).toBe(expected);
    expect(result.p95).toBeLessThan(300);
  });
});
