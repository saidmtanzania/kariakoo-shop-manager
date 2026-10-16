import { describe, expect, it } from 'vitest';
import {
  allocateCharges,
  landedCostPerBase,
  lineTotal,
  PurchaseRuleError,
  purchaseSchema,
  sumAmounts,
  supplierPaymentSchema,
} from './purchases.js';

describe('lineTotal', () => {
  it('multiplies quantity by the cost of one unit', () => {
    expect(lineTotal('2', '21600')).toBe('43200');
  });

  it('rounds fractional quantities half-up to whole shillings (D-021)', () => {
    expect(lineTotal('1.5', '1999')).toBe('2999'); // 2998.5
    expect(lineTotal('0.333', '1000')).toBe('333');
    expect(() => lineTotal('0.0005', '1000')).toThrow();
  });
});

describe('allocateCharges (D-015)', () => {
  it('spreads extra costs by line value', () => {
    expect(allocateCharges(['43200', '10800'], '1200')).toEqual(['960', '240']);
  });

  it('always adds up to the extra exactly, giving leftovers to the largest remainders', () => {
    const shares = allocateCharges(['100', '100', '100'], '100');
    expect(shares).toEqual(['34', '33', '33']);
    expect(sumAmounts(shares)).toBe('100');
    const uneven = allocateCharges(['1', '2', '7'], '9');
    expect(sumAmounts(uneven)).toBe('9');
    expect(uneven).toEqual(['1', '2', '6']);
  });

  it('gives nothing when there are no extra costs', () => {
    expect(allocateCharges(['0', '500'], '0')).toEqual(['0', '0']);
  });

  it('gives a free line no share', () => {
    expect(allocateCharges(['0', '500'], '50')).toEqual(['0', '50']);
  });

  it('refuses extra costs when the goods have no value to spread them over', () => {
    expect(() => allocateCharges(['0', '0'], '50')).toThrow(PurchaseRuleError);
  });
});

describe('landedCostPerBase', () => {
  it('includes the share of extra costs, per base unit', () => {
    // 2 cartons × 12 pieces at 21,600 a carton, plus 1,200 transport.
    expect(landedCostPerBase('43200', '1200', '24')).toBe('1850.0000');
  });

  it('keeps 4 decimals, rounding half-up', () => {
    expect(landedCostPerBase('1000', '0', '3')).toBe('333.3333');
    expect(landedCostPerBase('2000', '0', '3')).toBe('666.6667');
  });

  it('handles fractional base quantities (kg)', () => {
    expect(landedCostPerBase('2999', '1', '1.5')).toBe('2000.0000');
  });
});

describe('schemas', () => {
  const line = {
    productId: '01890000-0000-7000-8000-000000000001',
    unitId: '01890000-0000-7000-8000-000000000002',
    quantity: '2',
    unitCost: '21600',
  };

  it('accepts a purchase with lines and charges', () => {
    const parsed = purchaseSchema.safeParse({
      supplierId: '01890000-0000-7000-8000-000000000003',
      lines: [line],
      charges: [{ description: 'Transport', amount: '1200' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses no lines, zero quantities and costs with cents', () => {
    const base = {
      supplierId: '01890000-0000-7000-8000-000000000003',
      charges: [],
    };
    expect(purchaseSchema.safeParse({ ...base, lines: [] }).success).toBe(
      false,
    );
    expect(
      purchaseSchema.safeParse({ ...base, lines: [{ ...line, quantity: '0' }] })
        .success,
    ).toBe(false);
    expect(
      purchaseSchema.safeParse({
        ...base,
        lines: [{ ...line, unitCost: '100.50' }],
      }).success,
    ).toBe(false);
  });

  it('needs a positive whole payment amount', () => {
    expect(
      supplierPaymentSchema.safeParse({ amount: '0', method: 'CASH' }).success,
    ).toBe(false);
    expect(
      supplierPaymentSchema.safeParse({ amount: '5000', method: 'CASH' })
        .success,
    ).toBe(true);
  });
});
