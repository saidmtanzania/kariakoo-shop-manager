'use client';

import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
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
export const KNOWN_ERRORS = new Set([
  'invalid_credentials',
  'email_not_verified',
  'rate_limited',
  'invalid_or_expired_token',
  'network',
  'permission_denied',
  'permission_escalation',
  'owner_protected',
  'owner_required',
  'last_owner',
  'role_name_taken',
  'role_in_use',
  'role_not_found',
  'member_not_found',
  'already_member',
  'invitation_pending',
  'invitation_not_found',
  'invitation_expired',
  'invitation_revoked',
  'invitation_used',
  'invitation_email_mismatch',
  'invitation_not_pending',
  'resend_limit',
  'seat_limit_reached',
  'shop_suspended',
  'subscription_read_only',
  'feature_not_in_plan',
  'plan_not_found',
  'plan_code_taken',
  'duplicate_feature',
  'payment_reference_used',
  'reference_required',
  'idempotency_conflict',
  'too_many_pending_payments',
  'payment_method_unavailable',
  'payment_not_found',
  'payment_already_decided',
  'payment_not_pending',
  'payment_not_confirmed',
  'platform_admin_required',
  'sku_taken',
  'barcode_taken',
  'unit_name_taken',
  'conversion_not_whole',
  'category_not_found',
  'category_name_taken',
  'too_many_units',
  'product_has_stock',
  'product_limit_reached',
  'product_not_found',
  'unit_not_found',
  'base_unit_fixed',
  'insufficient_stock',
  'adjustment_no_change',
  'opening_stock_exists',
  'fraction_not_allowed',
  'base_fraction_not_allowed',
  'quantity_required',
  'note_required',
  'cost_only_for_added_stock',
  'product_archived',
  'invalid_cursor',
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

/** Whether the signed-in user holds a permission in the active shop. */
export function can(
  info: SessionInfo | null | undefined,
  permission: string,
): boolean {
  return Boolean(info?.permissions.includes(permission));
}

/**
 * Only same-site paths are allowed as a redirect target after sign-in, so a
 * crafted link cannot send the user to another site.
 */
export function safeNext(value: string | null | undefined): string {
  return value && /^\/(?![/\\])/.test(value) ? value : '/';
}

/**
 * An invitation token kept for this browser tab while the invitee signs in
 * or creates an account. Storage can be unavailable (private mode), in which
 * case the invitee opens the emailed link again.
 */
const INVITATION_KEY = 'ksm_invitation_token';
const invitationListeners = new Set<() => void>();

export function storeInvitationToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(INVITATION_KEY, token);
    else sessionStorage.removeItem(INVITATION_KEY);
  } catch {
    // Storage blocked: nothing to remember.
  }
  invitationListeners.forEach((l) => l());
}

export function readInvitationToken(): string | null {
  try {
    return sessionStorage.getItem(INVITATION_KEY);
  } catch {
    return null;
  }
}

export function useHasPendingInvitation(): boolean {
  return useSyncExternalStore(
    (listener) => {
      invitationListeners.add(listener);
      return () => invitationListeners.delete(listener);
    },
    () => readInvitationToken() !== null,
    () => false,
  );
}
