import { Injectable } from '@nestjs/common';
import type { MembershipSummary } from '@ksm/shared';
import type { ShopContext } from '../../../common/auth/request-context.js';
import {
  MembershipStatus,
  PrismaService,
  ShopStatus,
  scopedToShop,
} from '../../../database/index.js';

export type MembershipCheck =
  | { ok: true; context: ShopContext }
  | {
      ok: false;
      reason: 'not_member' | 'membership_inactive' | 'shop_suspended';
    };

export interface MemberView {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  isOwner: boolean;
  status: MembershipStatus;
  joinedAt: string;
}

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { user: { select: { fullName: true, email: true } } },
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
    }));
  }
}
