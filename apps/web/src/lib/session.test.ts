import { ApiError } from './api';
import { SHOP_PERMISSIONS, type SessionInfo } from '@ksm/shared';
import en from '../../messages/en.json';
import sw from '../../messages/sw.json';
import {
  can,
  errorKey,
  KNOWN_ERRORS,
  readInvitationToken,
  safeNext,
  storeInvitationToken,
  takeTokenFromHash,
} from './session';

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

describe('safeNext', () => {
  it('allows same-site paths only', () => {
    expect(safeNext('/invitations/accept')).toBe('/invitations/accept');
    for (const bad of [
      null,
      '',
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      'javascript:alert(1)',
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});

describe('can', () => {
  it('checks the active shop permissions from the session', () => {
    const info = { permissions: ['users.read'] } as unknown as SessionInfo;
    expect(can(info, 'users.read')).toBe(true);
    expect(can(info, 'users.manage')).toBe(false);
    expect(can(null, 'users.read')).toBe(false);
  });
});

describe('invitation token storage', () => {
  it('keeps and clears the token for this tab', () => {
    storeInvitationToken('tok');
    expect(readInvitationToken()).toBe('tok');
    storeInvitationToken(null);
    expect(readInvitationToken()).toBeNull();
  });
});

describe('messages', () => {
  type Messages = Record<string, unknown>;
  const lookup = (messages: Messages, path: string) =>
    path
      .split('.')
      .reduce<unknown>(
        (node, key) => (node as Messages | undefined)?.[key],
        messages,
      );

  it.each([
    ['en', en],
    ['sw', sw],
  ])(
    '%s has a message for every known error and every shop permission',
    (_, messages) => {
      for (const code of KNOWN_ERRORS)
        expect(lookup(messages, `Errors.${code}`), code).toEqual(
          expect.any(String),
        );
      for (const code of SHOP_PERMISSIONS) {
        expect(lookup(messages, `Permissions.${code}`), code).toEqual(
          expect.any(String),
        );
      }
    },
  );
});
