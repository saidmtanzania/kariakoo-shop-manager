import { moneyStringSchema, quantityStringSchema } from './money.js';

describe('moneyStringSchema', () => {
  it.each(['24000', '24000.00', '2500.5', '-150.25', '0'])(
    'accepts %s',
    (v) => {
      expect(moneyStringSchema.safeParse(v).success).toBe(true);
    },
  );

  it.each(['24,000', '1.234', 'abc', '', '1e5'])('rejects %s', (v) => {
    expect(moneyStringSchema.safeParse(v).success).toBe(false);
  });

  it('rejects numbers so floats never carry money', () => {
    expect(moneyStringSchema.safeParse(24000).success).toBe(false);
  });
});

describe('quantityStringSchema', () => {
  it('accepts up to 3 decimal places', () => {
    expect(quantityStringSchema.safeParse('12.125').success).toBe(true);
    expect(quantityStringSchema.safeParse('12.1255').success).toBe(false);
  });
});
