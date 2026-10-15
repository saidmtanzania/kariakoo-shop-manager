import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // Connections are opened lazily, so the API can start (and report
    // "not ready") while the database is unavailable.
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        connectionTimeoutMillis: 2_000,
      }),
    });
  }

  /** True when a trivial query succeeds within the timeout. */
  async isReachable(timeoutMs = 2_000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([
        this.$queryRaw`SELECT 1`.then(() => true),
        timeout,
      ]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
