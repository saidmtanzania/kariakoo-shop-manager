'use client';

import { useQuery } from '@tanstack/react-query';
import type { SessionInfo } from '@ksm/shared';
import { ApiError, apiFetch } from './api';

export const SESSION_KEY = ['session'] as const;

/** The signed-in user and their shops, or null when signed out. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async ({ signal }) => {
      try {
        return await apiFetch<SessionInfo>('/auth/session', { signal });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

/** Error codes with a translated message; anything else shows a generic one. */
const KNOWN_ERRORS = new Set([
  'invalid_credentials',
  'email_not_verified',
  'rate_limited',
  'invalid_or_expired_token',
  'network',
]);

export function errorKey(err: unknown): string {
  return err instanceof ApiError && KNOWN_ERRORS.has(err.code)
    ? err.code
    : 'generic';
}

/** Reads and then removes the single-use token from the URL fragment. */
export function takeTokenFromHash(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  if (token) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  return token;
}
