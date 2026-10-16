import { Injectable } from '@nestjs/common';
import { generateToken, hashToken } from '../../../common/crypto/tokens.js';
import { newId } from '../../../common/ids/ids.js';
import {
  AuthTokenPurpose,
  Prisma,
  PrismaService,
  type AuthToken,
} from '../../../database/index.js';

export const TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
  EMAIL_VERIFY: 24 * 3_600_000,
  PASSWORD_RESET: 30 * 60_000,
};

type Db = PrismaService | Prisma.TransactionClient;

/** Single-use, time-limited email tokens, stored only as hashes. */
@Injectable()
export class AuthTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /** Issues a new token and invalidates earlier unused ones of the same purpose. */
  async issue(
    userId: string,
    purpose: AuthTokenPurpose,
    db: Db = this.prisma,
  ): Promise<string> {
    const token = generateToken();
    const now = new Date();
    await db.authToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
    await db.authToken.create({
      data: {
        id: newId(),
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[purpose]),
      },
    });
    return token;
  }

  /**
   * Marks a token used and returns it, or null when it is unknown, expired,
   * already used or for another purpose. The conditional update makes
   * concurrent redemptions of the same token succeed at most once.
   */
  async consume(
    rawToken: string,
    purpose: AuthTokenPurpose,
    db: Db = this.prisma,
  ): Promise<AuthToken | null> {
    const now = new Date();
    const tokenHash = hashToken(rawToken);
    const { count } = await db.authToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) return null;
    return db.authToken.findUnique({ where: { tokenHash } });
  }
}
