import { newId } from '../../../backend/src/common/ids/ids.js';
import type { Client } from './auth.js';

/** Test amounts only; never real business figures. */
export async function createSupplier(
  agent: Client,
  body: Record<string, unknown> = {},
  expected = 201,
) {
  const res = await agent
    .post('/api/v1/shops/current/suppliers')
    .send({ name: `Supplier ${newId().slice(-12)}`, ...body })
    .expect(expected);
  return res.body;
}

export function pay(
  agent: Client,
  supplierId: string,
  body: Record<string, unknown>,
) {
  return agent
    .post(`/api/v1/shops/current/suppliers/${supplierId}/payments`)
    .send({ method: 'CASH', idempotencyKey: `pay-${newId()}`, ...body });
}

export async function supplierOf(agent: Client, supplierId: string) {
  return (
    await agent.get(`/api/v1/shops/current/suppliers/${supplierId}`).expect(200)
  ).body;
}

export async function entriesOf(agent: Client, supplierId: string) {
  return (
    await agent
      .get(`/api/v1/shops/current/suppliers/${supplierId}/entries`)
      .expect(200)
  ).body.entries as { type: string; amount: string; balanceAfter: string }[];
}

export interface Line {
  productId: string;
  unitId: string;
  quantity: string;
  unitCost: string;
}

export function draft(
  agent: Client,
  body: {
    supplierId: string;
    lines: Line[];
    charges?: { description: string; amount: string }[];
    supplierReference?: string;
    idempotencyKey?: string;
  },
) {
  return agent.post('/api/v1/shops/current/purchases').send({
    charges: [],
    idempotencyKey: `pur-${newId()}`,
    ...body,
  });
}

export function receive(
  agent: Client,
  purchaseId: string,
  body: Record<string, unknown> = {},
) {
  return agent
    .post(`/api/v1/shops/current/purchases/${purchaseId}/receive`)
    .send(body);
}

export function cancel(
  agent: Client,
  purchaseId: string,
  reason = 'Wrong goods',
) {
  return agent
    .post(`/api/v1/shops/current/purchases/${purchaseId}/cancel`)
    .send({ reason });
}
