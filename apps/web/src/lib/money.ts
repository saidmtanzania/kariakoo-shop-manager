/**
 * Shows a decimal money string (decision A-008) with thousands separators,
 * without converting it to a floating-point number. Whole amounts drop the
 * ".00" (TZS is normally shown without cents).
 */
export function formatMoney(amount: string, currency: string): string {
  const negative = amount.startsWith('-');
  const [whole = '0', cents = ''] = amount.replace(/^-/, '').split('.');
  const grouped = whole
    .replace(/^0+(?=\d)/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = /^0*$/.test(cents) ? '' : `.${cents.padEnd(2, '0')}`;
  return `${currency} ${negative ? '-' : ''}${grouped}${fraction}`;
}
