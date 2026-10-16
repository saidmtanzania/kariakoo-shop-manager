import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CategoryView } from '@ksm/shared';
import type {
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  Prisma,
  PrismaService,
  scopedToShop,
  type ProductCategory,
} from '../../../database/index.js';
import { AuditService } from '../../audit/services/audit.service.js';

const nameTaken = () =>
  new ConflictException({
    message: 'A category with this name already exists.',
    code: 'category_name_taken',
  });

const isUnique = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Product categories: a flat list, archived rather than deleted. */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: ShopContext): Promise<CategoryView[]> {
    const rows = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).productCategory.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { products: { where: { archivedAt: null } } } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      archived: c.archivedAt !== null,
      productCount: c._count.products,
    }));
  }

  async create(
    ctx: ShopContext,
    name: string,
    client: ClientInfo,
  ): Promise<CategoryView> {
    const id = newId();
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        await db.productCategory.create({
          data: { id, shopId: ctx.shopId, name: name.trim() },
        });
        await this.audit.record(
          {
            action: 'category.created',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'product_category',
            entityId: id,
            after: { name: name.trim() },
            client,
          },
          db,
        );
      });
    } catch (err) {
      if (isUnique(err)) throw nameTaken();
      throw err;
    }
    return this.get(ctx, id);
  }

  async update(
    ctx: ShopContext,
    id: string,
    input: { name?: string; archived?: boolean },
    client: ClientInfo,
  ): Promise<CategoryView> {
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        const before = await db.productCategory.findUnique({ where: { id } });
        if (!before) throw notFound();
        const after = await db.productCategory.update({
          where: { id },
          data: {
            name: input.name?.trim(),
            archivedAt:
              input.archived === undefined
                ? undefined
                : input.archived
                  ? (before.archivedAt ?? new Date())
                  : null,
          },
        });
        const snap = (c: ProductCategory) => ({
          name: c.name,
          archived: c.archivedAt !== null,
        });
        await this.audit.record(
          {
            action: 'category.updated',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'product_category',
            entityId: id,
            before: snap(before),
            after: snap(after),
            client,
          },
          db,
        );
      });
    } catch (err) {
      if (isUnique(err)) throw nameTaken();
      throw err;
    }
    return this.get(ctx, id);
  }

  private async get(ctx: ShopContext, id: string): Promise<CategoryView> {
    const found = (await this.list(ctx)).find((c) => c.id === id);
    if (!found) throw notFound();
    return found;
  }
}

function notFound() {
  return new NotFoundException({
    message: 'Category not found.',
    code: 'category_not_found',
  });
}
