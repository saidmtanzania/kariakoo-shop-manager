import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  InvitationPreview,
  InvitationStatus as Status,
  InvitationView,
} from '@ksm/shared';
import type {
  AuthContext,
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import { generateToken, hashToken } from '../../../common/crypto/tokens.js';
import { newId } from '../../../common/ids/ids.js';
import {
  InvitationStatus,
  MembershipStatus,
  PrismaService,
  ShopStatus,
  scopedToShop,
  type Invitation,
} from '../../../database/index.js';
import { MailService } from '../../../mail/mail.service.js';
import { invitationMessage } from '../../../mail/templates.js';
import { OutboxService } from '../../../outbox/outbox.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SessionService } from '../../auth/services/session.service.js';
import { AuthorizationService } from '../../authorization/services/authorization.service.js';
import { RolesService } from '../../authorization/services/roles.service.js';
import { SubscriptionsService } from '../../subscriptions/services/subscriptions.service.js';
import { normalizeEmail } from '../../users/services/users.service.js';

export const INVITATION_TTL_MS = 7 * 24 * 3_600_000;
export const MAX_RESENDS = 5;

type ScopedTx = Parameters<
  Parameters<ReturnType<typeof scopedToShop>['$transaction']>[0]
>[0];

const notFound = () =>
  new NotFoundException({
    message: 'Invitation not found.',
    code: 'invitation_not_found',
  });

/** PENDING invitations past their expiry are reported as EXPIRED. */
function effectiveStatus(
  inv: Pick<Invitation, 'status' | 'expiresAt'>,
  now = new Date(),
): Status {
  return inv.status === InvitationStatus.PENDING && inv.expiresAt <= now
    ? 'EXPIRED'
    : inv.status;
}

/**
 * Staff invitations (WF-03). Tokens are 32 random bytes, stored as SHA-256
 * hashes, single-use, valid for 7 days, revocable, and bound to one shop and
 * one email address. Resending replaces the token.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly roles: RolesService,
    private readonly sessions: SessionService,
    private readonly outbox: OutboxService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async list(ctx: ShopContext): Promise<InvitationView[]> {
    const rows = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).invitation.findMany({
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
        invitedBy: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const now = new Date();
    return rows.map((inv) => ({
      id: inv.id,
      email: inv.email,
      status: effectiveStatus(inv, now),
      roles: inv.roles
        .map((r) => r.role)
        .sort((a, b) => a.name.localeCompare(b.name)),
      invitedBy: inv.invitedBy?.user.fullName ?? null,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      resendCount: inv.resendCount,
    }));
  }

  async create(
    ctx: ShopContext,
    input: { email: string; roleIds: string[] },
    client: ClientInfo,
  ): Promise<InvitationView> {
    const email = normalizeEmail(input.email);
    const invitationId = newId();
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      const roles = await this.roles.findForAssignment(db, input.roleIds);
      this.authorization.assertHoldsAll(
        ctx,
        roles.flatMap((r) => r.permissions),
      );
      const shop = await this.lockShop(db, ctx.shopId);

      const existingMember = await db.shopMembership.findFirst({
        where: { user: { email }, status: { not: MembershipStatus.REMOVED } },
      });
      if (existingMember) {
        throw new ConflictException({
          message: 'This person is already a member of the shop.',
          code: 'already_member',
        });
      }
      await db.invitation.updateMany({
        where: {
          email,
          status: InvitationStatus.PENDING,
          expiresAt: { lte: new Date() },
        },
        data: { status: InvitationStatus.EXPIRED },
      });
      const pending = await db.invitation.count({
        where: { email, status: InvitationStatus.PENDING },
      });
      if (pending > 0) {
        throw new ConflictException({
          message:
            'This email already has a pending invitation. Resend it instead.',
          code: 'invitation_pending',
        });
      }
      await this.assertSeatAvailable(db, ctx.shopId);

      const token = generateToken();
      await db.invitation.create({
        data: {
          id: invitationId,
          shopId: ctx.shopId,
          email,
          tokenHash: hashToken(token),
          invitedByMembershipId: ctx.membershipId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
      });
      await db.invitationRole.createMany({
        data: roles.map((r) => ({
          shopId: ctx.shopId,
          invitationId,
          roleId: r.id,
        })),
      });
      await this.queueEmail(db, ctx, shop.name, email, token);
      await this.audit.record(
        {
          ...this.auditBase(ctx, invitationId, client),
          action: 'invitation.created',
          after: { email, roles: roles.map((r) => r.name).sort() },
        },
        db,
      );
    });
    return this.get(ctx, invitationId);
  }

  /** Sends a new link (the old one stops working) and restarts the 7 days. */
  async resend(
    ctx: ShopContext,
    invitationId: string,
    client: ClientInfo,
  ): Promise<InvitationView> {
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      const shop = await this.lockShop(db, ctx.shopId);
      const inv = await db.invitation.findUnique({
        where: { id: invitationId },
        include: { roles: { select: { roleId: true } } },
      });
      if (!inv) throw notFound();
      if (
        inv.status !== InvitationStatus.PENDING &&
        inv.status !== InvitationStatus.EXPIRED
      ) {
        throw new ConflictException({
          message: 'Only pending or expired invitations can be resent.',
          code: 'invitation_not_pending',
        });
      }
      if (inv.resendCount >= MAX_RESENDS) {
        throw new HttpException(
          {
            message:
              'This invitation has been resent too many times. Revoke it and invite again.',
            code: 'resend_limit',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const roles = await this.roles.findForAssignment(
        db,
        inv.roles.map((r) => r.roleId),
      );
      this.authorization.assertHoldsAll(
        ctx,
        roles.flatMap((r) => r.permissions),
      );
      if (effectiveStatus(inv) === 'EXPIRED')
        await this.assertSeatAvailable(db, ctx.shopId, invitationId);

      const token = generateToken();
      await db.invitation.update({
        where: { id: invitationId },
        data: {
          status: InvitationStatus.PENDING,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          resendCount: { increment: 1 },
        },
      });
      await this.queueEmail(db, ctx, shop.name, inv.email, token);
      await this.audit.record(
        {
          ...this.auditBase(ctx, invitationId, client),
          action: 'invitation.resent',
          after: { email: inv.email },
        },
        db,
      );
    });
    return this.get(ctx, invitationId);
  }

  async revoke(
    ctx: ShopContext,
    invitationId: string,
    client: ClientInfo,
  ): Promise<InvitationView> {
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      const inv = await db.invitation.findUnique({
        where: { id: invitationId },
      });
      if (!inv) throw notFound();
      const { count } = await db.invitation.updateMany({
        where: {
          id: invitationId,
          status: { in: [InvitationStatus.PENDING, InvitationStatus.EXPIRED] },
        },
        data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
      });
      if (count !== 1) {
        throw new ConflictException({
          message: 'This invitation is no longer pending.',
          code: 'invitation_not_pending',
        });
      }
      await this.audit.record(
        {
          ...this.auditBase(ctx, invitationId, client),
          action: 'invitation.revoked',
          before: { email: inv.email },
        },
        db,
      );
    });
    return this.get(ctx, invitationId);
  }

  /**
   * What the invitee sees before accepting. The token is the only key, so
   * it reveals nothing to anyone who does not hold the emailed link.
   */
  async preview(rawToken: string): Promise<InvitationPreview> {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: {
        shop: { select: { name: true } },
        invitedBy: { include: { user: { select: { fullName: true } } } },
      },
    });
    if (!inv) throw notFound();
    return {
      shopName: inv.shop.name,
      email: inv.email,
      invitedBy: inv.invitedBy?.user.fullName ?? null,
      status: effectiveStatus(inv),
      expiresAt: inv.expiresAt.toISOString(),
    };
  }

  /**
   * Accepts an invitation for the signed-in user, whose (verified) email must
   * match the invitation. Creates or reactivates the membership with the
   * invitation's roles and makes the shop the session's active shop.
   */
  async accept(
    auth: AuthContext,
    rawToken: string,
    client: ClientInfo,
  ): Promise<{ shopId: string }> {
    // Look up by token first: the token is the invitee's only key to the shop.
    const found = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { id: true, shopId: true },
    });
    if (!found) throw notFound();
    await this.assertWritable(found.shopId);

    await scopedToShop(this.prisma, found.shopId).$transaction(async (db) => {
      const shop = await this.lockShop(db, found.shopId);
      const inv = await db.invitation.findUnique({
        where: { id: found.id },
        include: { roles: { select: { roleId: true } } },
      });
      if (!inv) throw notFound();
      this.assertAcceptable(inv, auth.email);
      if (shop.status === ShopStatus.SUSPENDED) {
        throw new ForbiddenException({
          message: 'This shop is suspended.',
          code: 'shop_suspended',
        });
      }

      const existing = await db.shopMembership.findFirst({
        where: { userId: auth.userId },
      });
      if (existing && existing.status !== MembershipStatus.REMOVED) {
        throw new ConflictException({
          message: 'You are already a member of this shop.',
          code: 'already_member',
        });
      }
      await this.assertSeatAvailable(db, found.shopId, inv.id, 1);

      const { count } = await db.invitation.updateMany({
        where: {
          id: inv.id,
          status: InvitationStatus.PENDING,
          tokenHash: hashToken(rawToken),
        },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedUserId: auth.userId,
        },
      });
      if (count !== 1) throw used();

      const membershipId = existing?.id ?? newId();
      if (existing) {
        await db.shopMembership.update({
          where: { id: existing.id },
          data: {
            status: MembershipStatus.ACTIVE,
            isOwner: false,
            joinedAt: new Date(),
          },
        });
        await db.membershipRole.deleteMany({ where: { membershipId } });
      } else {
        await db.shopMembership.create({
          data: { id: membershipId, shopId: found.shopId, userId: auth.userId },
        });
      }
      if (inv.roles.length > 0) {
        await db.membershipRole.createMany({
          data: inv.roles.map((r) => ({
            shopId: found.shopId,
            membershipId,
            roleId: r.roleId,
          })),
        });
      }
      await this.audit.record(
        {
          action: 'invitation.accepted',
          shopId: found.shopId,
          actorUserId: auth.userId,
          actorMembershipId: membershipId,
          entityType: 'invitation',
          entityId: inv.id,
          after: { email: inv.email, membershipId },
          client,
        },
        db,
      );
    });
    await this.sessions.setActiveShop(auth.sessionId, found.shopId);
    return { shopId: found.shopId };
  }

  private assertAcceptable(
    inv: Pick<Invitation, 'status' | 'expiresAt' | 'email'>,
    userEmail: string,
  ): void {
    const status = effectiveStatus(inv);
    if (status === 'REVOKED') {
      throw new GoneException({
        message: 'This invitation was cancelled.',
        code: 'invitation_revoked',
      });
    }
    if (status === 'EXPIRED') {
      throw new GoneException({
        message: 'This invitation has expired. Ask the shop for a new one.',
        code: 'invitation_expired',
      });
    }
    if (status === 'ACCEPTED') throw used();
    if (normalizeEmail(inv.email) !== normalizeEmail(userEmail)) {
      throw new ForbiddenException({
        message:
          'This invitation was sent to a different email address. Sign in with that address to accept it.',
        code: 'invitation_email_mismatch',
      });
    }
  }

  /**
   * Seats are members who are not removed plus unexpired pending
   * invitations, against the plan's `seats` limit (decision D-005; the
   * trial has no limit). The shop row lock taken by the caller serialises
   * concurrent invitations and acceptances.
   */
  private async assertSeatAvailable(
    db: ScopedTx,
    shopId: string,
    excludeInvitationId?: string,
    adding = 1,
  ): Promise<void> {
    const limit = await this.subscriptions.seatLimit(shopId);
    if (limit === null) return;
    const [members, pending] = await Promise.all([
      db.shopMembership.count({
        where: { status: { not: MembershipStatus.REMOVED } },
      }),
      db.invitation.count({
        where: {
          status: InvitationStatus.PENDING,
          expiresAt: { gt: new Date() },
          ...(excludeInvitationId ? { id: { not: excludeInvitationId } } : {}),
        },
      }),
    ]);
    if (members + pending + adding > limit) {
      throw new HttpException(
        {
          message: `Your plan allows ${limit} staff seat${limit === 1 ? '' : 's'}, and they are all in use.`,
          code: 'seat_limit_reached',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /**
   * Joining a shop adds work to it, so a read-only shop cannot take on new
   * members (decision D-019). Invite and resend are refused by the access
   * guard; acceptance has no shop context there, so it is checked here.
   */
  private async assertWritable(shopId: string): Promise<void> {
    if ((await this.subscriptions.entitlements(shopId)).readOnly) {
      throw new HttpException(
        {
          message:
            'This shop’s subscription has ended, so it cannot add staff until it is renewed.',
          code: 'subscription_read_only',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /** Serialises invitation and seat changes within one shop. */
  private async lockShop(
    db: ScopedTx,
    shopId: string,
  ): Promise<{ name: string; status: ShopStatus }> {
    const rows = await db.$queryRaw<{ name: string; status: ShopStatus }[]>`
      SELECT name, status FROM shops WHERE id = ${shopId}::uuid FOR UPDATE`;
    if (rows.length !== 1) throw notFound();
    return rows[0]!;
  }

  private async queueEmail(
    db: ScopedTx,
    ctx: ShopContext,
    shopName: string,
    email: string,
    token: string,
  ) {
    const inviter = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { fullName: true },
    });
    await this.outbox.enqueueEmail(
      invitationMessage(
        email,
        shopName,
        inviter?.fullName ?? null,
        this.mail.link('/invitations/accept', token),
      ),
      { db, shopId: ctx.shopId },
    );
  }

  private async get(
    ctx: ShopContext,
    invitationId: string,
  ): Promise<InvitationView> {
    const inv = (await this.list(ctx)).find((i) => i.id === invitationId);
    if (!inv) throw notFound();
    return inv;
  }

  private auditBase(
    ctx: ShopContext,
    invitationId: string,
    client: ClientInfo,
  ) {
    return {
      shopId: ctx.shopId,
      actorUserId: ctx.userId,
      actorMembershipId: ctx.membershipId,
      entityType: 'invitation',
      entityId: invitationId,
      client,
    };
  }
}

function used() {
  return new ConflictException({
    message: 'This invitation has already been used.',
    code: 'invitation_used',
  });
}
