import { ForbiddenException, Injectable } from '@nestjs/common';
import { SHOP_PERMISSIONS } from '@ksm/shared';
import type { ShopContext } from '../../../common/auth/request-context.js';
import { PrismaService, scopedToShop } from '../../../database/index.js';

export type MembershipRef = Omit<ShopContext, 'permissions'>;

const ALL_SHOP_PERMISSIONS: ReadonlySet<string> = new Set(SHOP_PERMISSIONS);

/**
 * Effective permissions and the no-escalation rule (security model
 * section 5). Permissions are read from the database on every request, so
 * role and membership changes apply on the member's next request.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Owners hold every shop permission; others hold the union of their roles. */
  async permissionsFor(ref: MembershipRef): Promise<ReadonlySet<string>> {
    if (ref.isOwner) return ALL_SHOP_PERMISSIONS;
    const rows = await scopedToShop(
      this.prisma,
      ref.shopId,
    ).rolePermission.findMany({
      where: {
        role: { members: { some: { membershipId: ref.membershipId } } },
      },
      select: { permissionCode: true },
    });
    return new Set(rows.map((r) => r.permissionCode));
  }

  /**
   * An actor may only grant, take away or manage permissions they hold
   * themselves. Owners hold all shop permissions; platform permissions are
   * never in a shop's catalog, so nobody can grant them here.
   */
  assertHoldsAll(ctx: ShopContext, codes: Iterable<string>): void {
    if (ctx.isOwner) return;
    const missing = [...new Set(codes)].filter(
      (code) => !ctx.permissions.has(code),
    );
    if (missing.length > 0) {
      throw new ForbiddenException({
        message: 'You can only grant or manage permissions you hold yourself.',
        code: 'permission_escalation',
      });
    }
  }

  /**
   * Buying prices and average costs are visible to (and set by) people who
   * can change prices or see profit reports; cashiers see selling prices only.
   */
  canSeeCosts(ctx: ShopContext): boolean {
    return (
      ctx.permissions.has('products.prices.update') ||
      ctx.permissions.has('reports.profit.read')
    );
  }
}
