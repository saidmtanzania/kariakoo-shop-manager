import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../../../common/ids/ids.js';
import type { ClientInfo } from '../../../common/auth/request-context.js';
import type { AuditEntryView } from '@ksm/shared';
import type { ShopContext } from '../../../common/auth/request-context.js';
import {
  Prisma,
  PrismaService,
  scopedToShop,
} from '../../../database/index.js';

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
  | 'shop.updated'
  | 'role.created'
  | 'role.updated'
  | 'role.deleted'
  | 'member.roles_changed'
  | 'member.suspended'
  | 'member.reactivated'
  | 'member.removed'
  | 'member.ownership_changed'
  | 'invitation.created'
  | 'invitation.resent'
  | 'invitation.revoked'
  | 'invitation.accepted'
  | 'subscription.started'
  | 'subscription.payment_submitted'
  | 'subscription.payment_confirmed'
  | 'subscription.payment_failed'
  | 'subscription.payment_reversed'
  | 'subscription.payment_flagged'
  | 'platform.plan_created'
  | 'platform.plan_updated'
  | 'platform.billing_settings_updated'
  | 'platform.admin_granted'
  | 'platform.admin_revoked';

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

  /**
   * The active shop's audit trail, newest first. Ids are UUID v7, so they
   * sort by time and serve as the page cursor (decision A-004).
   */
  async listForShop(
    ctx: ShopContext,
    query: { cursor?: string; limit?: number },
  ): Promise<{ entries: AuditEntryView[]; nextCursor: string | null }> {
    const limit = query.limit ?? 50;
    const rows = await scopedToShop(this.prisma, ctx.shopId).auditLog.findMany({
      where: query.cursor ? { id: { lt: query.cursor } } : {},
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const actorIds = [
      ...new Set(
        page
          .map((r) => r.actorUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, fullName: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.fullName]));
    return {
      entries: page.map((r) => ({
        id: r.id,
        action: r.action,
        actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
        entityType: r.entityType,
        entityId: r.entityId,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? page.at(-1)!.id : null,
    };
  }
}
