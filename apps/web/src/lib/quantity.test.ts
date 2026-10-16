import { describe, expect, it } from 'vitest';
import { formatQuantity } from './quantity';

describe('formatQuantity', () => {
  it.each([
    ['24.000', '24'],
    ['73.745', '73.745'],
    ['1.250', '1.25'],
    ['-12.000', '-12'],
    ['1200.500', '1,200.5'],
    ['0.000', '0'],
    ['-0.000', '0'],
    ['1234567', '1,234,567'],
  ])('shows %s as %s', (input, expected) => {
    expect(formatQuantity(input)).toBe(expected);
  });
});
