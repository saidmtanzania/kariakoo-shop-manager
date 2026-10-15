import { generateToken, hashToken, safeEqual } from './tokens.js';

describe('tokens', () => {
  it('generates unique 43-character URL-safe tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashes to 64 hex characters deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('compares in constant time and handles length differences', () => {
    expect(safeEqual('same', 'same')).toBe(true);
    expect(safeEqual('same', 'diff')).toBe(false);
    expect(safeEqual('short', 'longer')).toBe(false);
  });
});
