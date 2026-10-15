import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/env.schema.js';
import type { ClientInfo } from '../../../common/auth/request-context.js';
import { generateToken, hashToken } from '../../../common/crypto/tokens.js';
import { newId } from '../../../common/ids/ids.js';
import {
  Prisma,
  PrismaService,
  UserStatus,
  type Session,
  type User,
} from '../../../database/index.js';

const HOUR_MS = 3_600_000;
/** Sliding expiry is refreshed at most this often, to avoid a write per request. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

type Db = PrismaService | Prisma.TransactionClient;

export interface ResolvedSession {
  session: Session;
  user: User;
}

/** Server-side sessions behind an HttpOnly cookie (decision A-003). */
@Injectable()
export class SessionService {
  readonly cookieName: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    // __Host- cookies are only accepted over HTTPS, host-only, path /.
    this.cookieName = config.COOKIE_SECURE
      ? '__Host-ksm_session'
      : 'ksm_session';
  }

  /** Creates a session and returns the raw token for the cookie. */
  async create(
    userId: string,
    activeShopId: string | null,
    client: ClientInfo,
    db: Db = this.prisma,
  ): Promise<{ token: string; session: Session }> {
    const token = generateToken();
    const now = Date.now();
    const session = await db.session.create({
      data: {
        id: newId(),
        userId,
        tokenHash: hashToken(token),
        activeShopId,
        ip: client.ip,
        userAgent: client.userAgent,
        idleExpiresAt: new Date(now + this.config.SESSION_IDLE_HOURS * HOUR_MS),
        expiresAt: new Date(
          now + this.config.SESSION_ABSOLUTE_DAYS * 24 * HOUR_MS,
        ),
      },
    });
    return { token, session };
  }

  /** Looks up a live session for a cookie token and slides its idle expiry. */
  async resolve(token: string | undefined): Promise<ResolvedSession | null> {
    if (!token || token.length > 200) return null;
    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.idleExpiresAt <= now ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: now,
          idleExpiresAt: new Date(
            Math.min(
              now.getTime() + this.config.SESSION_IDLE_HOURS * HOUR_MS,
              session.expiresAt.getTime(),
            ),
          ),
        },
      });
    }
    const { user, ...rest } = session;
    return { session: rest, user };
  }

  async setActiveShop(
    sessionId: string,
    shopId: string | null,
    db: Db = this.prisma,
  ): Promise<void> {
    await db.session.update({
      where: { id: sessionId },
      data: { activeShopId: shopId },
    });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, db: Db = this.prisma): Promise<void> {
    await db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  writeCookie(res: Response, token: string): void {
    res.cookie(this.cookieName, token, {
      ...this.cookieOptions(),
      maxAge: this.config.SESSION_ABSOLUTE_DAYS * 24 * HOUR_MS,
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
    };
  }
}
