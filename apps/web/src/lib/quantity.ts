/**
 * Shows a decimal quantity string ("24.000", "-1.250") without converting
 * it to a floating-point number: trailing zeros are dropped and thousands
 * are grouped ("24", "-1.25", "1,200").
 */
export function formatQuantity(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  const grouped = whole
    .replace(/^0+(?=\d)/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = fraction.replace(/0+$/, '');
  const sign = negative && /[1-9]/.test(value) ? '-' : '';
  return `${sign}${grouped}${trimmed ? `.${trimmed}` : ''}`;
}

/** A new random key for one attempt at a request that must not repeat. */
export function newRequestKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
