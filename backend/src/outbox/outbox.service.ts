import { Injectable } from '@nestjs/common';
import { newId } from '../common/ids/ids.js';
import { Prisma, PrismaService } from '../database/index.js';
import type { MailMessage } from '../mail/mail.service.js';

export const OUTBOX_EMAIL = 'email';

/** Anything that can insert an outbox row: the client or a transaction. */
interface OutboxWriter {
  outboxMessage: {
    create(args: {
      data: Prisma.OutboxMessageUncheckedCreateInput;
    }): PromiseLike<unknown>;
  };
}

/**
 * Records side effects in the same transaction as the change that causes
 * them (decision A-007). If the transaction rolls back, nothing is sent; if
 * it commits, the worker delivers the message, retrying on failure.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueueEmail(
    message: MailMessage,
    options: { db?: OutboxWriter; shopId?: string | null } = {},
  ): Promise<void> {
    const db = options.db ?? this.prisma;
    await db.outboxMessage.create({
      data: {
        id: newId(),
        shopId: options.shopId ?? null,
        type: OUTBOX_EMAIL,
        payload: { ...message },
      },
    });
  }
}
