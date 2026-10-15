import { SetMetadata } from '@nestjs/common';

/**
 * Access levels (security model sections 4 and 5). Every route has exactly
 * one; routes without a decorator require a signed-in user (deny by default).
 *
 * - public: no session needed (login, health, payment callbacks).
 * - user:   a valid session; no shop context (account and shop selection).
 * - shop:   a valid session AND an active shop the user is an ACTIVE member of.
 */
export type AccessLevel = 'public' | 'user' | 'shop';

export const ACCESS_LEVEL_KEY = 'ksm:access-level';
export const OWNER_ONLY_KEY = 'ksm:owner-only';
export const SKIP_CSRF_KEY = 'ksm:skip-csrf';

/** No session required. */
export const Public = () =>
  SetMetadata(ACCESS_LEVEL_KEY, 'public' satisfies AccessLevel);

/** Requires a session and a validated active shop membership. */
export const ShopScoped = () =>
  SetMetadata(ACCESS_LEVEL_KEY, 'shop' satisfies AccessLevel);

/**
 * Restricts a shop-scoped route to shop owners. Temporary until the dynamic
 * permission catalog arrives in Phase 03, which replaces it with permissions.
 */
export const OwnerOnly = () => SetMetadata(OWNER_ONLY_KEY, true);

/** For server-to-server endpoints (e.g. verified provider callbacks) only. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
