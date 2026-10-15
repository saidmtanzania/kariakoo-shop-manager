import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MemberView, MembershipSummary } from '@ksm/shared';
import type {
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import {
  MembershipStatus,
  PrismaService,
  ShopStatus,
  scopedToShop,
} from '../../../database/index.js';
import { AuditService } from '../../audit/services/audit.service.js';
import {
  AuthorizationService,
  type MembershipRef,
} from '../../authorization/services/authorization.service.js';
import { RolesService } from '../../authorization/services/roles.service.js';

export type MembershipCheck =
  | { ok: true; context: MembershipRef }
  | {
      ok: false;
      reason: 'not_member' | 'membership_inactive' | 'shop_suspended';
    };

const memberNotFound = () =>
  new NotFoundException({
    message: 'Member not found.',
    code: 'member_not_found',
  });

/**
 * Shop memberships and staff management (WF-03, security model section 5).
 * Rules for changing another member:
 * - only owners can change an owner, and the last active owner can never be
 *   removed, suspended or demoted;
 * - everyone else can only manage members whose permissions they hold, and
 *   only assign roles whose permissions they hold (no escalation).
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Validates that a user may act in a shop right now. The shop id must come
   * from the server-side session (or be the target of a switch request that
   * this check then validates), never be trusted on its own.
   */
  async check(userId: string, shopId: string): Promise<MembershipCheck> {
    const membership = await scopedToShop(
      this.prisma,
      shopId,
    ).shopMembership.findFirst({
      where: { userId },
      include: { shop: { select: { status: true } } },
    });
    if (!membership) return { ok: false, reason: 'not_member' };
    if (membership.status !== MembershipStatus.ACTIVE)
      return { ok: false, reason: 'membership_inactive' };
    if (membership.shop.status === ShopStatus.SUSPENDED)
      return { ok: false, reason: 'shop_suspended' };
    return {
      ok: true,
      context: {
        shopId,
        membershipId: membership.id,
        userId,
        isOwner: membership.isOwner,
      },
    };
  }

  /**
   * The user's own active memberships across shops. This is the one
   * cross-shop read, and it is filtered by the authenticated user id.
   */
  async listForUser(userId: string): Promise<MembershipSummary[]> {
    const rows = await this.prisma.shopMembership.findMany({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        shop: { status: { not: ShopStatus.SUSPENDED } },
      },
      include: { shop: { select: { name: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((m) => ({
      membershipId: m.id,
      shopId: m.shopId,
      shopName: m.shop.name,
      isOwner: m.isOwner,
    }));
  }

  async listMembers(ctx: ShopContext): Promise<MemberView[]> {
    const rows = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).shopMembership.findMany({
      where: { status: { not: MembershipStatus.REMOVED } },
      include: {
        user: { select: { fullName: true, email: true } },
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      fullName: m.user.fullName,
      email: m.user.email,
      isOwner: m.isOwner,
      status: m.status,
      joinedAt: m.joinedAt.toISOString(),
      roles: m.roles
        .map((r) => r.role)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  /** Replaces a member's roles. */
  async setRoles(
    ctx: ShopContext,
    membershipId: string,
    roleIds: string[],
    client: ClientInfo,
  ): Promise<MemberView> {
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      const target = await this.loadTarget(db, membershipId);
      this.assertCanManage(ctx, target);
      const next = await this.roles.findForAssignment(db, roleIds);
      this.authorization.assertHoldsAll(ctx, [
        ...target.permissionCodes,
        ...next.flatMap((r) => r.permissions),
      ]);

      await db.membershipRole.deleteMany({ where: { membershipId } });
      if (next.length > 0) {
        await db.membershipRole.createMany({
          data: next.map((r) => ({
            shopId: ctx.shopId,
            membershipId,
            roleId: r.id,
          })),
        });
      }
      await this.audit.record(
        {
          ...this.auditBase(ctx, membershipId, client),
          action: 'member.roles_changed',
          before: { roles: target.roleNames },
          after: { roles: next.map((r) => r.name).sort() },
        },
        db,
      );
    });
    return this.getMember(ctx, membershipId);
  }

  /** Suspends, reactivates or removes a member. */
  async setStatus(
    ctx: ShopContext,
    membershipId: string,
    status: MembershipStatus,
    client: ClientInfo,
  ): Promise<void> {
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      await this.lockShop(db, ctx.shopId);
      const target = await this.loadTarget(db, membershipId);
      this.assertCanManage(ctx, target);
      this.authorization.assertHoldsAll(ctx, target.permissionCodes);
      if (target.status === status) return;
      if (target.isOwner && status !== MembershipStatus.ACTIVE) {
        await this.assertAnotherActiveOwner(db, membershipId);
      }

      await db.shopMembership.update({
        where: { id: membershipId },
        // A removed member keeps no roles; rejoining needs a new invitation.
        data: {
          status,
          ...(status === MembershipStatus.REMOVED ? { isOwner: false } : {}),
        },
      });
      if (status === MembershipStatus.REMOVED) {
        await db.membershipRole.deleteMany({ where: { membershipId } });
      }
      await this.audit.record(
        {
          ...this.auditBase(ctx, membershipId, client),
          action:
            status === MembershipStatus.REMOVED
              ? 'member.removed'
              : status === MembershipStatus.SUSPENDED
                ? 'member.suspended'
                : 'member.reactivated',
          before: { status: target.status, isOwner: target.isOwner },
          after: { status },
        },
        db,
      );
    });
  }

  /** Makes an active member an owner, or demotes an owner (owners only). */
  async setOwner(
    ctx: ShopContext,
    membershipId: string,
    isOwner: boolean,
    client: ClientInfo,
  ): Promise<MemberView> {
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      await this.lockShop(db, ctx.shopId);
      const target = await this.loadTarget(db, membershipId);
      if (target.status !== MembershipStatus.ACTIVE) {
        throw new ConflictException({
          message: 'Only an active member can be an owner.',
          code: 'member_inactive',
        });
      }
      if (target.isOwner === isOwner) return;
      if (!isOwner) await this.assertAnotherActiveOwner(db, membershipId);

      await db.shopMembership.update({
        where: { id: membershipId },
        data: { isOwner },
      });
      await this.audit.record(
        {
          ...this.auditBase(ctx, membershipId, client),
          action: 'member.ownership_changed',
          before: { isOwner: target.isOwner },
          after: { isOwner },
        },
        db,
      );
    });
    return this.getMember(ctx, membershipId);
  }

  private async getMember(
    ctx: ShopContext,
    membershipId: string,
  ): Promise<MemberView> {
    const member = (await this.listMembers(ctx)).find(
      (m) => m.membershipId === membershipId,
    );
    if (!member) throw memberNotFound();
    return member;
  }

  private async loadTarget(db: TxDb, membershipId: string) {
    const target = await db.shopMembership.findUnique({
      where: { id: membershipId },
      include: {
        roles: {
          include: {
            role: {
              include: { permissions: { select: { permissionCode: true } } },
            },
          },
        },
      },
    });
    if (!target || target.status === MembershipStatus.REMOVED)
      throw memberNotFound();
    return {
      id: target.id,
      status: target.status,
      isOwner: target.isOwner,
      roleNames: target.roles.map((r) => r.role.name).sort(),
      permissionCodes: target.roles.flatMap((r) =>
        r.role.permissions.map((p) => p.permissionCode),
      ),
    };
  }

  private assertCanManage(
    ctx: ShopContext,
    target: { isOwner: boolean },
  ): void {
    if (target.isOwner && !ctx.isOwner) {
      throw new ForbiddenException({
        message: 'Only an owner can change another owner.',
        code: 'owner_protected',
      });
    }
  }

  private async assertAnotherActiveOwner(
    db: TxDb,
    membershipId: string,
  ): Promise<void> {
    const others = await db.shopMembership.count({
      where: {
        isOwner: true,
        status: MembershipStatus.ACTIVE,
        id: { not: membershipId },
      },
    });
    if (others === 0) {
      throw new ConflictException({
        message: 'A shop must keep at least one active owner.',
        code: 'last_owner',
      });
    }
  }

  /** Serialises owner and seat changes within one shop. */
  private async lockShop(db: TxDb, shopId: string): Promise<void> {
    await db.$queryRaw`SELECT id FROM shops WHERE id = ${shopId}::uuid FOR UPDATE`;
  }

  private auditBase(
    ctx: ShopContext,
    membershipId: string,
    client: ClientInfo,
  ) {
    return {
      shopId: ctx.shopId,
      actorUserId: ctx.userId,
      actorMembershipId: ctx.membershipId,
      entityType: 'membership',
      entityId: membershipId,
      client,
    };
  }
}

type TxDb = Parameters<
  Parameters<ReturnType<typeof scopedToShop>['$transaction']>[0]
>[0];
