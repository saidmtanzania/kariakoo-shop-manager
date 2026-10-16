/**
 * Exact decimal arithmetic on strings, using scaled BigInts. Money and
 * quantities never pass through a floating-point number (decision A-008).
 *
 * A value at scale s is the integer value × 10^s: "12.5" at scale 3 is 12500n.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

export class DecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalError';
  }
}

/** Number of digits after the decimal point, ignoring trailing zeros. */
export function decimalPlaces(value: string): number {
  const m = DECIMAL.exec(value.trim());
  if (!m) throw new DecimalError(`Not a decimal: ${value}`);
  return (m[3] ?? '').replace(/0+$/, '').length;
}

/**
 * Parses a decimal string at a fixed scale. More significant decimals than
 * the scale allows is an error, never a silent rounding.
 */
export function toScaled(value: string, scale: number): bigint {
  const m = DECIMAL.exec(value.trim());
  if (!m) throw new DecimalError(`Not a decimal: ${value}`);
  const fraction = (m[3] ?? '').replace(/0+$/, '');
  if (fraction.length > scale) {
    throw new DecimalError(`${value} has more than ${scale} decimal places`);
  }
  const digits = BigInt(`${m[2]}${fraction.padEnd(scale, '0')}`);
  return m[1] ? -digits : digits;
}

/** Formats a scaled value with exactly `scale` decimals ("12.500"). */
export function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, '0');
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? '' : `.${digits.slice(-scale)}`;
  return `${negative && value !== 0n ? '-' : ''}${whole}${fraction}`;
}

/** Integer division rounding half away from zero ("half-up", D-021). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new DecimalError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

/** Changes scale; going down rounds half-up. */
export function rescale(value: bigint, from: number, to: number): bigint {
  if (to >= from) return value * 10n ** BigInt(to - from);
  return divRoundHalfUp(value, 10n ** BigInt(from - to));
}

/** Compares two decimal strings exactly. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const scale = Math.max(decimalPlaces(a), decimalPlaces(b));
  const x = toScaled(a, scale);
  const y = toScaled(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}
