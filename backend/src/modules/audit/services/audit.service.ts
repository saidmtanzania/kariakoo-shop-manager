import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../../../common/ids/ids.js';
import type { ClientInfo } from '../../../common/auth/request-context.js';
import { Prisma, PrismaService } from '../../../database/index.js';

export type AuditAction =
  | 'auth.registered'
  | 'auth.email_verified'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'session.shop_switched'
  | 'shop.created'
  | 'shop.updated';

export interface AuditEntry {
  action: AuditAction;
  shopId?: string | null;
  actorUserId?: string | null;
  actorMembershipId?: string | null;
  entityType?: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  client?: ClientInfo;
}

/** Anything that can insert an audit row: the client, a transaction, or a shop-scoped client. */
interface AuditWriter {
  auditLog: {
    create(args: {
      data: Prisma.AuditLogUncheckedCreateInput;
    }): PromiseLike<unknown>;
  };
}

/** Append-only audit trail (security model section 12). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records an entry, inside the caller's transaction when one is passed. */
  async record(
    entry: AuditEntry,
    db: AuditWriter = this.prisma,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        id: newId(),
        action: entry.action,
        shopId: entry.shopId ?? null,
        actorUserId: entry.actorUserId ?? null,
        actorMembershipId: entry.actorMembershipId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        before: entry.before,
        after: entry.after,
        ip: entry.client?.ip ?? null,
        userAgent: entry.client?.userAgent ?? null,
      },
    });
  }

  /** For events outside a transaction whose failure must not fail the request. */
  async recordQuietly(entry: AuditEntry): Promise<void> {
    await this.record(entry).catch((err: unknown) =>
      this.logger.error(
        { err, action: entry.action },
        'Failed to write audit log',
      ),
    );
  }
}
