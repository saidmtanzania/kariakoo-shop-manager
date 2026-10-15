import { ApiError } from './api';
import { errorKey, takeTokenFromHash } from './session';

describe('takeTokenFromHash', () => {
  it('returns the token and removes it from the address bar', () => {
    window.history.replaceState(null, '', '/verify-email#token=abc_DEF-123');
    expect(takeTokenFromHash()).toBe('abc_DEF-123');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/verify-email');
  });

  it('returns null when there is no token', () => {
    window.history.replaceState(null, '', '/reset-password');
    expect(takeTokenFromHash()).toBeNull();
  });
});

describe('errorKey', () => {
  it('maps known API codes and hides everything else', () => {
    expect(errorKey(new ApiError(429, 'rate_limited', ''))).toBe(
      'rate_limited',
    );
    expect(errorKey(new ApiError(500, 'internal_server_error', ''))).toBe(
      'generic',
    );
    expect(errorKey(new Error('boom'))).toBe('generic');
  });
});
