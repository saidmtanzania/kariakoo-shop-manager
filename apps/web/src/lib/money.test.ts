import { formatMoney } from './money';

describe('formatMoney', () => {
  it('groups thousands without floating-point conversion', () => {
    expect(formatMoney('25000.00', 'TZS')).toBe('TZS 25,000');
    expect(formatMoney('1234567.5', 'TZS')).toBe('TZS 1,234,567.50');
    expect(formatMoney('9999999999999999.99', 'TZS')).toBe(
      'TZS 9,999,999,999,999,999.99',
    );
    expect(formatMoney('0.00', 'TZS')).toBe('TZS 0');
    expect(formatMoney('-1500', 'TZS')).toBe('TZS -1,500');
  });
});
