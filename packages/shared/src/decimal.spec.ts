import {
  compareDecimal,
  decimalPlaces,
  divRoundHalfUp,
  fromScaled,
  rescale,
  toScaled,
} from './decimal.js';

describe('decimal helpers', () => {
  it('parses and formats at a fixed scale without floats', () => {
    expect(toScaled('12.5', 3)).toBe(12500n);
    expect(toScaled('-0.125', 3)).toBe(-125n);
    expect(toScaled('24000.00', 0)).toBe(24000n);
    expect(fromScaled(12500n, 3)).toBe('12.500');
    expect(fromScaled(-125n, 3)).toBe('-0.125');
    expect(fromScaled(7n, 0)).toBe('7');
    expect(fromScaled(0n, 4)).toBe('0.0000');
  });

  it('refuses extra decimals instead of rounding them away', () => {
    expect(() => toScaled('1.2345', 3)).toThrow();
    expect(() => toScaled('1e5', 3)).toThrow();
    expect(() => toScaled('', 3)).toThrow();
  });

  it('counts significant decimals', () => {
    expect(decimalPlaces('1.500')).toBe(1);
    expect(decimalPlaces('12')).toBe(0);
  });

  it('rounds half away from zero', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divRoundHalfUp(5n, 3n)).toBe(2n);
    expect(rescale(18405n, 4, 2)).toBe(184n);
    expect(rescale(18450n, 4, 2)).toBe(185n);
    expect(rescale(12n, 0, 3)).toBe(12000n);
  });

  it('compares exactly', () => {
    expect(compareDecimal('0.1', '0.10')).toBe(0);
    expect(compareDecimal('2', '10')).toBe(-1);
    expect(compareDecimal('-1.5', '-1.49')).toBe(-1);
  });
});
