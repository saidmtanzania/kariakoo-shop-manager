import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { PrismaService } from '../database/index.js';
import { MailService, type MailMessage } from '../mail/mail.service.js';
import { OUTBOX_EMAIL } from './outbox.service.js';

export const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const LOCK_SECONDS = 60;

interface ClaimedRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/**
 * Delivers outbox messages. Rows are claimed with FOR UPDATE SKIP LOCKED, so
 * several API instances can run the worker without sending a message twice;
 * a claim that is not finished within LOCK_SECONDS (a crashed process) is
 * picked up again. Failures retry with backoff, up to MAX_ATTEMPTS.
 *
 * Delivered and failed rows keep only non-secret fields: email bodies carry
 * single-use tokens and are removed from the payload.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.OUTBOX_WORKER === 'off') return;
    this.timer = setInterval(() => {
      void this.drain().catch((err: unknown) =>
        this.logger.error({ err }, 'Outbox worker failed'),
      );
    }, this.config.OUTBOX_POLL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }

  /** Processes everything that is due now; returns how many rows were handled. */
  drain(): Promise<number> {
    // One drain at a time per process; callers share the running one.
    this.running ??= this.drainAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drainAll(): Promise<number> {
    let handled = 0;
    for (;;) {
      const rows = await this.claim();
      if (rows.length === 0) return handled;
      // RETURNING does not keep the subquery's order; ids are UUID v7, so
      // sorting by id delivers messages in the order they were queued.
      rows.sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const row of rows) await this.process(row);
      handled += rows.length;
    }
  }

  private claim(): Promise<ClaimedRow[]> {
    return this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_messages
      SET status = 'PROCESSING',
          locked_until = now() + make_interval(secs => ${LOCK_SECONDS}),
          attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= now())
           OR (status = 'PROCESSING' AND locked_until < now())
        ORDER BY available_at, id
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, attempts`;
  }

  private async process(row: ClaimedRow): Promise<void> {
    const redacted = redact(row.payload);
    try {
      if (row.type !== OUTBOX_EMAIL)
        throw new Error(`Unknown outbox message type ${row.type}`);
      await this.mail.deliver(row.payload as MailMessage);
      await this.prisma.outboxMessage.update({
        where: { id: row.id },
        data: {
          status: 'DONE',
          processedAt: new Date(),
          lockedUntil: null,
          payload: redacted,
          lastError: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = row.attempts >= MAX_ATTEMPTS;
      this.logger.warn(
        { id: row.id, attempts: row.attempts, failed },
        'Outbox delivery failed',
      );
      await this.prisma.outboxMessage.update({
        where: { id: row.id },
        data: failed
          ? {
              status: 'FAILED',
              processedAt: new Date(),
              lockedUntil: null,
              payload: redacted,
              lastError: message.slice(0, 1000),
            }
          : {
              status: 'PENDING',
              lockedUntil: null,
              availableAt: new Date(
                Date.now() + 5_000 * 2 ** (row.attempts - 1),
              ),
              lastError: message.slice(0, 1000),
            },
      });
    }
  }
}

function redact(payload: unknown): { to?: string; subject?: string } {
  const p = (payload ?? {}) as Partial<MailMessage>;
  return { to: p.to, subject: p.subject };
}
