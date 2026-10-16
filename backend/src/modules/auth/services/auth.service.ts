import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { SessionInfo } from '@ksm/shared';
import type {
  AuthContext,
  ClientInfo,
} from '../../../common/auth/request-context.js';
import { RateLimitService } from '../../../common/rate-limit/rate-limit.service.js';
import {
  AuthTokenPurpose,
  PrismaService,
  UserStatus,
} from '../../../database/index.js';
import { MailService } from '../../../mail/mail.service.js';
import { OutboxService } from '../../../outbox/outbox.service.js';
import {
  accountExistsMessage,
  passwordChangedMessage,
  passwordResetMessage,
  verifyEmailMessage,
} from '../../../mail/templates.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { AuthorizationService } from '../../authorization/services/authorization.service.js';
import { MembershipsService } from '../../memberships/services/memberships.service.js';
import { PasswordService } from '../../users/services/password.service.js';
import {
  normalizeEmail,
  UsersService,
} from '../../users/services/users.service.js';
import { AuthTokensService } from './auth-tokens.service.js';
import { SubscriptionsService } from '../../subscriptions/services/subscriptions.service.js';
import { SessionService } from './session.service.js';

/** Failed logins per email before the account is temporarily locked. */
export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;

const invalidCredentials = () =>
  new UnauthorizedException({
    message: 'Email or password is incorrect.',
    code: 'invalid_credentials',
  });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: AuthTokensService,
    private readonly sessions: SessionService,
    private readonly memberships: MembershipsService,
    private readonly authorization: AuthorizationService,
    private readonly mail: MailService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Always answers the same way whether or not the email is registered, so
   * registration cannot be used to discover accounts. The existing owner
   * gets an email instead.
   */
  async register(
    input: { email: string; fullName: string; password: string },
    client: ClientInfo,
  ) {
    const email = normalizeEmail(input.email);
    // Hash first in both branches so response time does not reveal the answer.
    const passwordHash = await this.passwords.hash(input.password);
    const existing = await this.users.findByEmail(email);

    if (existing) {
      await this.outbox.enqueueEmail(
        accountExistsMessage(
          email,
          this.mail.link('/login'),
          this.mail.link('/forgot-password'),
        ),
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const user = await this.users.create(
        { email, fullName: input.fullName, passwordHash },
        tx,
      );
      const token = await this.tokens.issue(
        user.id,
        AuthTokenPurpose.EMAIL_VERIFY,
        tx,
      );
      await this.audit.record(
        {
          action: 'auth.registered',
          actorUserId: user.id,
          entityType: 'user',
          entityId: user.id,
          client,
        },
        tx,
      );
      await this.outbox.enqueueEmail(
        verifyEmailMessage(
          user.email,
          user.fullName,
          this.mail.link('/verify-email', token),
        ),
        { db: tx },
      );
    });
  }

  async verifyEmail(rawToken: string, client: ClientInfo): Promise<void> {
    const ok = await this.prisma.$transaction(async (tx) => {
      const token = await this.tokens.consume(
        rawToken,
        AuthTokenPurpose.EMAIL_VERIFY,
        tx,
      );
      if (!token) return false;
      await tx.user.updateMany({
        where: { id: token.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'auth.email_verified',
          actorUserId: token.userId,
          entityType: 'user',
          entityId: token.userId,
          client,
        },
        tx,
      );
      return true;
    });
    if (!ok) throw invalidToken();
  }

  async resendVerification(emailInput: string): Promise<void> {
    const user = await this.users.findByEmail(emailInput);
    if (!user || user.emailVerifiedAt || user.status !== UserStatus.ACTIVE)
      return;
    const token = await this.tokens.issue(
      user.id,
      AuthTokenPurpose.EMAIL_VERIFY,
    );
    await this.outbox.enqueueEmail(
      verifyEmailMessage(
        user.email,
        user.fullName,
        this.mail.link('/verify-email', token),
      ),
    );
  }

  async login(input: { email: string; password: string }, client: ClientInfo) {
    const email = normalizeEmail(input.email);
    const lockKey = `login-failures:${email}`;
    const failures = await this.limits.peek(lockKey);
    if (failures.hits >= LOGIN_FAILURE_LIMIT) {
      throw new HttpException(
        {
          message:
            'Too many failed sign-in attempts. Please wait and try again.',
          code: 'rate_limited',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.findByEmail(email);
    const passwordOk = await this.passwords.verify(
      user?.passwordHash ?? null,
      input.password,
    );
    if (!user || !passwordOk || user.status !== UserStatus.ACTIVE) {
      await this.limits.hit(
        lockKey,
        LOGIN_FAILURE_LIMIT,
        LOGIN_FAILURE_WINDOW_SECONDS,
      );
      await this.audit.recordQuietly({
        action: 'auth.login_failed',
        actorUserId: user?.id ?? null,
        entityType: user ? 'user' : undefined,
        entityId: user?.id,
        client,
      });
      throw invalidCredentials();
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        message: 'Confirm your email address before signing in.',
        code: 'email_not_verified',
      });
    }

    await this.limits.reset(lockKey);
    const memberships = await this.memberships.listForUser(user.id);
    // Choose the shop automatically only when there is exactly one.
    const activeShopId =
      memberships.length === 1 ? memberships[0]!.shopId : null;
    const { token, session } = await this.sessions.create(
      user.id,
      activeShopId,
      client,
    );
    await this.audit.recordQuietly({
      action: 'auth.login',
      actorUserId: user.id,
      entityType: 'session',
      entityId: session.id,
      client,
    });
    return { token };
  }

  async logout(auth: AuthContext, client: ClientInfo): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
    await this.audit.recordQuietly({
      action: 'auth.logout',
      actorUserId: auth.userId,
      entityType: 'session',
      entityId: auth.sessionId,
      client,
    });
  }

  async requestPasswordReset(
    emailInput: string,
    client: ClientInfo,
  ): Promise<void> {
    const user = await this.users.findByEmail(emailInput);
    if (!user || user.status !== UserStatus.ACTIVE) return;
    const token = await this.tokens.issue(
      user.id,
      AuthTokenPurpose.PASSWORD_RESET,
    );
    await this.audit.recordQuietly({
      action: 'auth.password_reset_requested',
      actorUserId: user.id,
      entityType: 'user',
      entityId: user.id,
      client,
    });
    await this.outbox.enqueueEmail(
      passwordResetMessage(
        user.email,
        this.mail.link('/reset-password', token),
      ),
    );
  }

  /** Sets a new password, confirms the email (the link proved ownership) and signs out every device. */
  async resetPassword(
    rawToken: string,
    password: string,
    client: ClientInfo,
  ): Promise<void> {
    const passwordHash = await this.passwords.hash(password);
    const user = await this.prisma.$transaction(async (tx) => {
      const token = await this.tokens.consume(
        rawToken,
        AuthTokenPurpose.PASSWORD_RESET,
        tx,
      );
      if (!token) return null;
      const existing = await this.users.findActiveById(token.userId, tx);
      if (!existing) return null;
      const user = await tx.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        },
      });
      await this.sessions.revokeAllForUser(user.id, tx);
      await this.audit.record(
        {
          action: 'auth.password_reset',
          actorUserId: user.id,
          entityType: 'user',
          entityId: user.id,
          client,
        },
        tx,
      );
      return user;
    });
    if (!user) throw invalidToken();
    await this.limits.reset(`login-failures:${user.email}`);
    await this.outbox.enqueueEmail(passwordChangedMessage(user.email));
  }

  async sessionInfo(auth: AuthContext): Promise<SessionInfo> {
    const memberships = await this.memberships.listForUser(auth.userId);
    const active = memberships.find((m) => m.shopId === auth.activeShopId);
    const permissions = active
      ? await this.authorization.permissionsFor({
          shopId: active.shopId,
          membershipId: active.membershipId,
          userId: auth.userId,
          isOwner: active.isOwner,
        })
      : new Set<string>();
    return {
      user: {
        id: auth.userId,
        email: auth.email,
        fullName: auth.fullName,
        isPlatformAdmin: auth.isPlatformAdmin,
      },
      activeShopId: active?.shopId ?? null,
      memberships,
      permissions: [...permissions].sort(),
      subscription: active
        ? await this.subscriptions.summary(active.shopId)
        : null,
    };
  }

  /**
   * Switches the session's active shop after validating membership. Unknown
   * shops and shops the user cannot access get the same 404, so shop ids
   * cannot be probed.
   */
  async switchShop(
    auth: AuthContext,
    shopId: string,
    client: ClientInfo,
  ): Promise<void> {
    const check = await this.memberships.check(auth.userId, shopId);
    if (!check.ok) {
      throw new NotFoundException({
        message: 'Shop not found.',
        code: 'shop_not_found',
      });
    }
    await this.sessions.setActiveShop(auth.sessionId, shopId);
    await this.audit.recordQuietly({
      action: 'session.shop_switched',
      shopId,
      actorUserId: auth.userId,
      actorMembershipId: check.context.membershipId,
      entityType: 'session',
      entityId: auth.sessionId,
      client,
    });
  }
}

function invalidToken() {
  return new BadRequestException({
    message: 'This link is invalid or has expired. Request a new one.',
    code: 'invalid_or_expired_token',
  });
}
