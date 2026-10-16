import {
  adjustmentSchema,
  conversionFits,
  priceStringSchema,
  productCreateSchema,
  QuantityError,
  toBaseQuantity,
} from './inventory.js';

const piece = { conversion: '1', allowFraction: false };
const carton = { conversion: '12', allowFraction: false };

describe('toBaseQuantity (unit conversions)', () => {
  it('converts cartons to pieces exactly (carton = 12)', () => {
    expect(toBaseQuantity('1', carton, false)).toBe('12.000');
    expect(toBaseQuantity('3', piece, false)).toBe('3.000');
    expect(toBaseQuantity('25', carton, false)).toBe('300.000');
  });

  it('refuses decimals in a whole-number unit (D-013)', () => {
    expect(() => toBaseQuantity('1.5', carton, false)).toThrow(QuantityError);
    expect(() => toBaseQuantity('0.5', piece, false)).toThrow(
      'fraction_not_allowed',
    );
  });

  it('allows up to 3 decimals in a unit that allows fractions', () => {
    const kg = { conversion: '1', allowFraction: true };
    expect(toBaseQuantity('1.255', kg, true)).toBe('1.255');
    const bag = { conversion: '50', allowFraction: true };
    expect(toBaseQuantity('0.5', bag, true)).toBe('25.000');
  });

  it('refuses a fractional unit quantity that lands between whole base units', () => {
    const halfable = { conversion: '12', allowFraction: true };
    expect(toBaseQuantity('0.5', halfable, false)).toBe('6.000');
    expect(() => toBaseQuantity('0.1', halfable, false)).toThrow(
      'base_fraction_not_allowed',
    );
  });

  it('refuses results finer than 3 decimals', () => {
    const odd = { conversion: '0.125', allowFraction: true };
    expect(() => toBaseQuantity('0.001', odd, true)).toThrow(
      'base_fraction_not_allowed',
    );
    expect(toBaseQuantity('2', odd, true)).toBe('0.250');
  });
});

describe('conversionFits', () => {
  it('needs whole conversions when the base unit is whole-only', () => {
    expect(conversionFits('12', false)).toBe(true);
    expect(conversionFits('12.5', false)).toBe(false);
    expect(conversionFits('12.5', true)).toBe(true);
    expect(conversionFits('0', true)).toBe(false);
    expect(conversionFits('abc', true)).toBe(false);
  });
});

describe('API schemas', () => {
  it('takes prices in whole shillings (D-021)', () => {
    expect(priceStringSchema.safeParse('24000').success).toBe(true);
    expect(priceStringSchema.safeParse('24000.00').success).toBe(true);
    expect(priceStringSchema.safeParse('2500.50').success).toBe(false);
    expect(priceStringSchema.safeParse('-1').success).toBe(false);
    expect(priceStringSchema.safeParse('24,000').success).toBe(false);
  });

  it('accepts a product with a carton unit and opening stock', () => {
    const parsed = productCreateSchema.parse({
      name: 'Soap',
      baseUnit: { name: 'piece', retailPrice: '2500' },
      units: [{ name: 'carton', conversion: '12', retailPrice: '24000' }],
      openingStock: { unitName: 'carton', quantity: '2', unitCost: '21600' },
    });
    expect(parsed.baseUnit.allowFraction).toBe(false);
    expect(parsed.units[0]!.conversion).toBe('12');
  });

  it('needs a note for OTHER and a positive quantity to add or remove', () => {
    const base = {
      productId: '0190a0c0-0000-7000-8000-000000000001',
      unitId: '0190a0c0-0000-7000-8000-000000000002',
      kind: 'remove',
      quantity: '1',
      reason: 'DAMAGED',
      idempotencyKey: 'key-12345',
    } as const;
    expect(adjustmentSchema.safeParse(base).success).toBe(true);
    expect(
      adjustmentSchema.safeParse({ ...base, reason: 'OTHER' }).success,
    ).toBe(false);
    expect(adjustmentSchema.safeParse({ ...base, quantity: '0' }).success).toBe(
      false,
    );
    expect(
      adjustmentSchema.safeParse({ ...base, kind: 'count', quantity: '0' })
        .success,
    ).toBe(true);
  });
});
