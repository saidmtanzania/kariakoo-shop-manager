import { newId } from '../../../backend/src/common/ids/ids.js';
import type { Client } from './auth.js';

/** Test prices and costs only; never real business figures. */
export const SOAP = {
  name: 'Bar soap',
  sku: 'SOAP-1',
  baseUnit: {
    name: 'piece',
    barcode: null as string | null,
    buyingPrice: '1800',
    retailPrice: '2500',
    wholesalePrice: '2200',
  },
  units: [
    {
      name: 'carton',
      conversion: '12',
      barcode: null as string | null,
      buyingPrice: '21600',
      retailPrice: '24000',
      wholesalePrice: '23000',
    },
  ],
};

let counter = 0;
const unique = (label: string) => `${label}-${Date.now()}-${++counter}`;

/** Creates a product (piece + carton of 12 by default) and returns its detail. */
export async function createProduct(
  agent: Client,
  overrides: Record<string, unknown> = {},
  expected = 201,
) {
  const res = await agent
    .post('/api/v1/shops/current/products')
    .send({
      ...SOAP,
      sku: unique('SKU'),
      baseUnit: { ...SOAP.baseUnit, barcode: unique('BC') },
      units: [{ ...SOAP.units[0], barcode: unique('BC') }],
      ...overrides,
    })
    .expect(expected);
  return res.body;
}

export function unitId(
  product: { units: { id: string; name: string }[] },
  name: string,
) {
  const unit = product.units.find((u) => u.name === name);
  if (!unit) throw new Error(`No unit ${name}`);
  return unit.id;
}

export function adjust(
  agent: Client,
  body: {
    productId: string;
    unitId: string;
    kind: 'add' | 'remove' | 'count';
    quantity: string;
    reason?: string;
    note?: string;
    unitCost?: string;
    idempotencyKey?: string;
  },
) {
  return agent.post('/api/v1/shops/current/inventory/adjustments').send({
    reason: 'COUNT_CORRECTION',
    idempotencyKey: `adj-${newId()}`,
    ...body,
  });
}

export async function stockOf(agent: Client, productId: string) {
  const res = await agent
    .get(`/api/v1/shops/current/products/${productId}`)
    .expect(200);
  return res.body.stock as {
    quantity: string | null;
    averageCost: string | null;
    lowStock: boolean;
  };
}
