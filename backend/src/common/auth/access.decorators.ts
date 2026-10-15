import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { ShopPermissionCode } from '@ksm/shared';

/**
 * Access levels (security model sections 3 to 5). Every route must declare
 * exactly one; a route without one is refused (fail closed), and the
 * route-inventory test fails the build.
 *
 * - public: no session needed (login, health, payment callbacks).
 * - user:   a valid session; no shop context (account and shop selection).
 * - shop:   a valid session AND an active shop the user is an ACTIVE member
 *           of, plus the declared permission when there is one.
 */
export type AccessLevel = 'public' | 'user' | 'shop';

export const ACCESS_LEVEL_KEY = 'ksm:access-level';
export const PERMISSION_KEY = 'ksm:permission';
export const OWNER_ONLY_KEY = 'ksm:owner-only';
export const SKIP_CSRF_KEY = 'ksm:skip-csrf';

/** No session required. */
export const Public = () =>
  SetMetadata(ACCESS_LEVEL_KEY, 'public' satisfies AccessLevel);

/** Requires a session only (account pages, choosing or creating a shop). */
export const SignedIn = () =>
  SetMetadata(ACCESS_LEVEL_KEY, 'user' satisfies AccessLevel);

/**
 * Requires an active membership of the session's active shop, with no
 * further permission. Use only for what every member may see (the shop's
 * name, their own permissions).
 */
export const ShopScoped = () =>
  SetMetadata(ACCESS_LEVEL_KEY, 'shop' satisfies AccessLevel);

/** Requires an active membership holding this permission (owners hold all). */
export const RequirePermission = (permission: ShopPermissionCode) =>
  applyDecorators(ShopScoped(), SetMetadata(PERMISSION_KEY, permission));

/** Requires an active owner of the active shop (ownership changes only). */
export const OwnerOnly = () =>
  applyDecorators(ShopScoped(), SetMetadata(OWNER_ONLY_KEY, true));

/** For server-to-server endpoints (e.g. verified provider callbacks) only. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
