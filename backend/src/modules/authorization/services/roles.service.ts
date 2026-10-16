import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_ROLE_TEMPLATES,
  PERMISSIONS,
  type PermissionInfo,
  type RoleView,
  type ShopPermissionCode,
} from '@ksm/shared';
import type {
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  InvitationStatus,
  Prisma,
  PrismaService,
  scopedToShop,
  type ShopScopedPrisma,
} from '../../../database/index.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { RoleDto } from '../dto/role.dto.js';
import { AuthorizationService } from './authorization.service.js';

const SHOP_CATALOG: PermissionInfo[] = PERMISSIONS.filter(
  (p) => p.scope === 'SHOP',
).map((p) => ({
  code: p.code as ShopPermissionCode,
  module: p.module,
}));

const roleNotFound = () =>
  new NotFoundException({ message: 'Role not found.', code: 'role_not_found' });

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

const duplicateName = () =>
  new ConflictException({
    message: 'A role with this name already exists.',
    code: 'role_name_taken',
  });

/** Custom shop roles (WF-04). */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  catalog(): PermissionInfo[] {
    return SHOP_CATALOG;
  }

  /** Creates the default roles for a new shop inside the caller's transaction. */
  async createDefaults(
    shopId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      const roleId = newId();
      await tx.role.create({
        data: {
          id: roleId,
          shopId,
          name: template.name,
          templateKey: template.key,
        },
      });
      await tx.rolePermission.createMany({
        data: template.permissions.map((permissionCode) => ({
          shopId,
          roleId,
          permissionCode,
        })),
      });
    }
  }

  async list(ctx: ShopContext): Promise<RoleView[]> {
    const roles = await scopedToShop(this.prisma, ctx.shopId).role.findMany({
      include: {
        permissions: { select: { permissionCode: true } },
        _count: {
          select: {
            members: { where: { membership: { status: { not: 'REMOVED' } } } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      permissions: r.permissions
        .map((p) => p.permissionCode as ShopPermissionCode)
        .sort(),
      memberCount: r._count.members,
    }));
  }

  async create(
    ctx: ShopContext,
    dto: RoleDto,
    client: ClientInfo,
  ): Promise<RoleView> {
    this.authorization.assertHoldsAll(ctx, dto.permissions);
    const roleId = newId();
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        await db.role.create({
          data: { id: roleId, shopId: ctx.shopId, name: dto.name.trim() },
        });
        await this.writePermissions(db, ctx.shopId, roleId, dto.permissions);
        await this.audit.record(
          {
            action: 'role.created',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'role',
            entityId: roleId,
            after: {
              name: dto.name.trim(),
              permissions: [...dto.permissions].sort(),
            },
            client,
          },
          db,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateName();
      throw err;
    }
    return this.get(ctx, roleId);
  }

  /**
   * Replaces a role's name and permissions. The actor must hold every
   * permission the role has before and after the change, so they can
   * neither add nor remove permissions above their own level.
   */
  async update(
    ctx: ShopContext,
    roleId: string,
    dto: RoleDto,
    client: ClientInfo,
  ): Promise<RoleView> {
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        const before = await db.role.findUnique({
          where: { id: roleId },
          include: { permissions: { select: { permissionCode: true } } },
        });
        if (!before) throw roleNotFound();
        const oldCodes = before.permissions.map((p) => p.permissionCode);
        this.authorization.assertHoldsAll(ctx, [
          ...oldCodes,
          ...dto.permissions,
        ]);

        await db.role.update({
          where: { id: roleId },
          data: { name: dto.name.trim() },
        });
        await db.rolePermission.deleteMany({ where: { roleId } });
        await this.writePermissions(db, ctx.shopId, roleId, dto.permissions);
        await this.audit.record(
          {
            action: 'role.updated',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'role',
            entityId: roleId,
            before: { name: before.name, permissions: oldCodes.sort() },
            after: {
              name: dto.name.trim(),
              permissions: [...dto.permissions].sort(),
            },
            client,
          },
          db,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateName();
      throw err;
    }
    return this.get(ctx, roleId);
  }

  /** Deletes a role nobody holds and no pending invitation offers. */
  async remove(
    ctx: ShopContext,
    roleId: string,
    client: ClientInfo,
  ): Promise<void> {
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      const role = await db.role.findUnique({
        where: { id: roleId },
        include: { permissions: { select: { permissionCode: true } } },
      });
      if (!role) throw roleNotFound();
      const codes = role.permissions.map((p) => p.permissionCode);
      this.authorization.assertHoldsAll(ctx, codes);

      const [members, invitations] = await Promise.all([
        db.membershipRole.count({ where: { roleId } }),
        db.invitationRole.count({
          where: { roleId, invitation: { status: InvitationStatus.PENDING } },
        }),
      ]);
      if (members > 0 || invitations > 0) {
        throw new ConflictException({
          message:
            'Remove this role from every member and pending invitation first.',
          code: 'role_in_use',
        });
      }
      await db.role.delete({ where: { id: roleId } });
      await this.audit.record(
        {
          action: 'role.deleted',
          shopId: ctx.shopId,
          actorUserId: ctx.userId,
          actorMembershipId: ctx.membershipId,
          entityType: 'role',
          entityId: roleId,
          before: { name: role.name, permissions: codes.sort() },
          client,
        },
        db,
      );
    });
  }

  /** Loads roles of this shop by id; unknown or foreign ids are an error. */
  async findForAssignment(
    db: Pick<ShopScopedPrisma, 'role'>,
    roleIds: string[],
  ): Promise<{ id: string; name: string; permissions: string[] }[]> {
    const unique = [...new Set(roleIds)];
    const roles = await db.role.findMany({
      where: { id: { in: unique } },
      include: { permissions: { select: { permissionCode: true } } },
    });
    if (roles.length !== unique.length) throw roleNotFound();
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      permissions: r.permissions.map((p) => p.permissionCode),
    }));
  }

  private async get(ctx: ShopContext, roleId: string): Promise<RoleView> {
    const role = (await this.list(ctx)).find((r) => r.id === roleId);
    if (!role) throw roleNotFound();
    return role;
  }

  private async writePermissions(
    db: {
      rolePermission: {
        createMany(args: {
          data: Prisma.RolePermissionCreateManyInput[];
        }): PromiseLike<unknown>;
      };
    },
    shopId: string,
    roleId: string,
    codes: string[],
  ): Promise<void> {
    if (codes.length === 0) return;
    await db.rolePermission.createMany({
      data: [...new Set(codes)].map((permissionCode) => ({
        shopId,
        roleId,
        permissionCode,
      })),
    });
  }
}
