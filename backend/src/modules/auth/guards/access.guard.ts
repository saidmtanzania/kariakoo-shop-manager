import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@ksm/shared';
import type { Response } from 'express';
import {
  ACCESS_LEVEL_KEY,
  ENTITLEMENT_KEY,
  type EntitlementRequirement,
  OWNER_ONLY_KEY,
  PERMISSION_KEY,
  SKIP_CSRF_KEY,
  type AccessLevel,
} from '../../../common/auth/access.decorators.js';
import type { AppRequest } from '../../../common/auth/request-context.js';
import { AuthorizationService } from '../../authorization/services/authorization.service.js';
import { MembershipsService } from '../../memberships/services/memberships.service.js';
import { SubscriptionsService } from '../../subscriptions/services/subscriptions.service.js';
import { SessionService } from '../services/session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The single global guard for every route (security model sections 3 to 5),
 * applied in a fixed order:
 *   1. CSRF: state-changing requests must carry X-Requested-With, which a
 *      cross-site form cannot send and a cross-origin script cannot send
 *      without passing CORS.
 *   2. Declared access: a route without @Public(), @SignedIn(),
 *      @ShopScoped(), @RequirePermission() or @OwnerOnly() is refused.
 *   3. Session: every route except @Public() needs one.
 *   4. Shop context: shop routes get the active shop from the server-side
 *      session and re-validate the membership on every request. Nothing the
 *      client sends can choose the shop.
 *   5. Permission: loaded from the database on every request, so role and
 *      membership changes apply immediately. Owners hold all permissions.
 *   6. Entitlement: what the shop's subscription allows (writable, plan
 *      features). Checked last, so a 402 never reveals anything to a member
 *      who lacks the permission anyway.
 *
 * Platform routes need a session whose user is a platform operator; they
 * never have a shop context.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly memberships: MembershipsService,
    private readonly authorization: AuthorizationService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<AppRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    const skipCsrf =
      this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, targets) ??
      false;
    if (
      !skipCsrf &&
      !SAFE_METHODS.has(req.method) &&
      req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE
    ) {
      throw new ForbiddenException({
        message: `State-changing requests must send ${CSRF_HEADER}: ${CSRF_HEADER_VALUE}.`,
        code: 'csrf_header_missing',
      });
    }

    const level = this.reflector.getAllAndOverride<AccessLevel | undefined>(
      ACCESS_LEVEL_KEY,
      targets,
    );
    if (!level) {
      // Fail closed; the route-inventory test catches this before release.
      throw new ForbiddenException({
        message: 'This route does not declare who may use it.',
        code: 'access_undeclared',
      });
    }
    if (level === 'public') return true;

    const cookies = req.cookies as Record<string, string> | undefined;
    const resolved = await this.sessions.resolve(
      cookies?.[this.sessions.cookieName],
    );
    if (!resolved) {
      if (cookies?.[this.sessions.cookieName]) this.sessions.clearCookie(res);
      throw new UnauthorizedException({
        message: 'Please sign in.',
        code: 'unauthenticated',
      });
    }
    req.auth = {
      userId: resolved.user.id,
      sessionId: resolved.session.id,
      email: resolved.user.email,
      fullName: resolved.user.fullName,
      activeShopId: resolved.session.activeShopId,
      isPlatformAdmin: resolved.user.isPlatformAdmin,
    };
    if (level === 'user') return true;
    if (level === 'platform') {
      if (!resolved.user.isPlatformAdmin) {
        throw new ForbiddenException({
          message: 'This is for platform staff only.',
          code: 'platform_admin_required',
        });
      }
      return true;
    }

    const shopId = resolved.session.activeShopId;
    if (!shopId) {
      throw new ForbiddenException({
        message: 'Choose a shop first.',
        code: 'no_active_shop',
      });
    }
    const check = await this.memberships.check(resolved.user.id, shopId);
    if (!check.ok) {
      // Access was removed since the shop was chosen: forget it on this session.
      await this.sessions.setActiveShop(resolved.session.id, null);
      throw new ForbiddenException({
        message: 'You no longer have access to this shop.',
        code:
          check.reason === 'shop_suspended'
            ? 'shop_suspended'
            : 'shop_access_revoked',
      });
    }
    const permissions = await this.authorization.permissionsFor(check.context);
    req.shopContext = { ...check.context, permissions };

    const required = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (required && !permissions.has(required)) {
      throw new ForbiddenException({
        message: 'You do not have permission to do this.',
        code: 'permission_denied',
      });
    }

    const ownerOnly =
      this.reflector.getAllAndOverride<boolean>(OWNER_ONLY_KEY, targets) ??
      false;
    if (ownerOnly && !check.context.isOwner) {
      throw new ForbiddenException({
        message: 'Only a shop owner can do this.',
        code: 'owner_required',
      });
    }

    const entitlement = this.reflector.getAllAndOverride<
      EntitlementRequirement | undefined
    >(ENTITLEMENT_KEY, targets);
    if (entitlement) {
      const ent = await this.subscriptions.entitlements(shopId);
      if (ent.readOnly) {
        throw new HttpException(
          {
            message:
              'Your subscription has ended, so the shop is read-only. Pay to continue recording new work.',
            code: 'subscription_read_only',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      if (
        entitlement.kind === 'feature' &&
        !ent.features[entitlement.feature].enabled
      ) {
        throw new HttpException(
          {
            message: 'Your plan does not include this feature.',
            code: 'feature_not_in_plan',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }
    return true;
  }
}
