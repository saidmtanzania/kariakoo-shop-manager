import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/index.js';

export interface RateLimitResult {
  allowed: boolean;
  hits: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters stored in PostgreSQL, so limits hold across API
 * instances without Redis (decision A-007).
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  /** Records one hit and reports whether it is within the limit. */
  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const rows = await this.prisma.$queryRaw<
      { hits: number; expires_at: Date }[]
    >`
      INSERT INTO rate_limit_counters (key, window_start, hits, expires_at)
      VALUES (${key}, now(), 1, now() + make_interval(secs => ${windowSeconds}))
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limit_counters.expires_at <= now() THEN 1
                    ELSE rate_limit_counters.hits + 1 END,
        window_start = CASE WHEN rate_limit_counters.expires_at <= now() THEN now()
                            ELSE rate_limit_counters.window_start END,
        expires_at = CASE WHEN rate_limit_counters.expires_at <= now()
                          THEN now() + make_interval(secs => ${windowSeconds})
                          ELSE rate_limit_counters.expires_at END
      RETURNING hits, expires_at`;
    const row = rows[0]!;
    if (Math.random() < 0.01) void this.purgeExpired();
    return this.toResult(row.hits, row.expires_at, limit);
  }

  /** Reads the current count without adding a hit. */
  async peek(
    key: string,
  ): Promise<{ hits: number; retryAfterSeconds: number }> {
    const row = await this.prisma.rateLimitCounter.findUnique({
      where: { key },
    });
    if (!row || row.expiresAt <= new Date())
      return { hits: 0, retryAfterSeconds: 0 };
    return {
      hits: row.hits,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000),
      ),
    };
  }

  async reset(key: string): Promise<void> {
    await this.prisma.rateLimitCounter.deleteMany({ where: { key } });
  }

  private toResult(
    hits: number,
    expiresAt: Date,
    limit: number,
  ): RateLimitResult {
    const allowed = hits <= limit;
    return {
      allowed,
      hits,
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)),
    };
  }

  private async purgeExpired(): Promise<void> {
    await this.prisma.rateLimitCounter
      .deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } },
      })
      .catch(() => undefined);
  }
}
