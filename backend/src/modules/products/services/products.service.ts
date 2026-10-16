import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  conversionFits,
  PRODUCT_LIMITS,
  type ProductDetail,
  type ProductListItem,
  type StockFilter,
  type UnitView,
} from '@ksm/shared';
import type {
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  Prisma,
  PrismaService,
  scopedToShop,
  type ProductUnit,
  type ShopScopedTx,
} from '../../../database/index.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { AuthorizationService } from '../../authorization/services/authorization.service.js';
import { InventoryService } from '../../inventory/services/inventory.service.js';
import { SubscriptionsService } from '../../subscriptions/services/subscriptions.service.js';

export interface PricesInput {
  buyingPrice?: string | null;
  retailPrice?: string | null;
  wholesalePrice?: string | null;
}

export interface BaseUnitInput extends PricesInput {
  name: string;
  allowFraction?: boolean;
  barcode?: string | null;
}

export interface UnitInput extends BaseUnitInput {
  conversion: string;
}

export interface CreateProductInput {
  name: string;
  categoryId?: string | null;
  sku?: string | null;
  reorderLevel?: string | null;
  baseUnit: BaseUnitInput;
  units?: UnitInput[];
  openingStock?: {
    unitName: string;
    quantity: string;
    unitCost?: string | null;
  } | null;
}

export interface UpdateProductInput {
  name?: string;
  categoryId?: string | null;
  sku?: string | null;
  reorderLevel?: string | null;
}

export interface UpdateUnitInput {
  name?: string;
  barcode?: string | null;
  allowFraction?: boolean;
  archived?: boolean;
}

export interface ListQuery {
  q?: string;
  categoryId?: string;
  archived?: boolean;
  stock?: StockFilter;
  cursor?: string;
  limit?: number;
}

const productNotFound = () =>
  new NotFoundException({
    message: 'Product not found.',
    code: 'product_not_found',
  });

const unitNotFound = () =>
  new NotFoundException({ message: 'Unit not found.', code: 'unit_not_found' });

/** Empty strings from forms mean "no value". */
const blank = (v: string | null | undefined): string | null | undefined =>
  v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim();

const money = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));
const qty = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(3));

/**
 * Prisma reports which unique index failed in different places depending
 * on the driver; look for the column name anywhere in the error.
 */
function uniqueViolation(err: unknown): string | null {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return null;
  }
  const text = `${JSON.stringify(err.meta ?? {})} ${err.message}`;
  for (const field of ['barcode', 'sku', 'name']) {
    if (text.includes(field)) return field;
  }
  return 'unknown';
}

function duplicateError(field: string | null): HttpException | null {
  if (field === 'barcode') {
    return new ConflictException({
      message: 'Another product in this shop already uses this barcode.',
      code: 'barcode_taken',
    });
  }
  if (field === 'sku') {
    return new ConflictException({
      message: 'Another product in this shop already uses this SKU.',
      code: 'sku_taken',
    });
  }
  if (field === 'name') {
    return new ConflictException({
      message: 'This product already has a unit with that name.',
      code: 'unit_name_taken',
    });
  }
  return null;
}

interface Cursor {
  n: string;
  i: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Cursor;
    if (typeof c.n === 'string' && typeof c.i === 'string') return c;
  } catch {
    // fall through
  }
  throw new BadRequestException({
    message: 'Invalid page cursor.',
    code: 'invalid_cursor',
  });
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

interface ListRow {
  id: string;
  name: string;
  sku: string | null;
  category_id: string | null;
  category_name: string | null;
  reorder_level: string | null;
  archived_at: Date | null;
  quantity: string;
  base_id: string;
  base_name: string;
  base_allow_fraction: boolean;
  retail_price: string | null;
  wholesale_price: string | null;
  matched_unit_id: string | null;
}

/** Products, their units and prices (WF-05). Stock changes go through inventory. */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly inventory: InventoryService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Search and list. `q` matches part of the name, the SKU, or a unit's
   * barcode exactly (for scanners). Sorted by name, paged by cursor.
   */
  async list(
    ctx: ShopContext,
    query: ListQuery,
  ): Promise<{ products: ProductListItem[]; nextCursor: string | null }> {
    const limit = Math.min(query.limit ?? 50, PRODUCT_LIMITS.pageMax);
    const q = query.q?.trim() || null;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const showStock = ctx.permissions.has('inventory.read');
    const shopId = ctx.shopId;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.shop_id = ${shopId}::uuid`,
      query.archived
        ? Prisma.sql`p.archived_at IS NOT NULL`
        : Prisma.sql`p.archived_at IS NULL`,
    ];
    if (query.categoryId) {
      conditions.push(Prisma.sql`p.category_id = ${query.categoryId}::uuid`);
    }
    if (q) {
      conditions.push(
        Prisma.sql`(p.name ILIKE ${`%${escapeLike(q)}%`} OR p.sku = ${q}::citext OR m.unit_id IS NOT NULL)`,
      );
    }
    if (query.stock === 'low') {
      conditions.push(
        Prisma.sql`p.reorder_level IS NOT NULL AND coalesce(b.quantity, 0) <= p.reorder_level`,
      );
    } else if (query.stock === 'out') {
      conditions.push(Prisma.sql`coalesce(b.quantity, 0) = 0`);
    } else if (query.stock === 'negative') {
      conditions.push(Prisma.sql`coalesce(b.quantity, 0) < 0`);
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(p.name, p.id) > (${cursor.n}, ${cursor.i}::uuid)`,
      );
    }

    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT p.id, p.name, p.sku::text AS sku, p.category_id, c.name::text AS category_name,
             p.reorder_level::text AS reorder_level, p.archived_at,
             coalesce(b.quantity, 0)::text AS quantity,
             bu.id AS base_id, bu.name::text AS base_name,
             bu.allow_fraction AS base_allow_fraction,
             bu.retail_price::text AS retail_price,
             bu.wholesale_price::text AS wholesale_price,
             m.unit_id AS matched_unit_id
      FROM products p
      JOIN product_units bu ON bu.shop_id = p.shop_id AND bu.product_id = p.id AND bu.is_base
      LEFT JOIN product_categories c ON c.shop_id = p.shop_id AND c.id = p.category_id
      LEFT JOIN stock_balances b ON b.shop_id = p.shop_id AND b.product_id = p.id
      LEFT JOIN LATERAL (
        SELECT u.id AS unit_id FROM product_units u
        WHERE ${q}::text IS NOT NULL AND u.shop_id = p.shop_id
          AND u.product_id = p.id AND u.barcode = ${q}::text AND u.archived_at IS NULL
        LIMIT 1) m ON true
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY p.name, p.id
      LIMIT ${limit + 1}`;

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      products: page.map((r) => {
        const quantity = new Prisma.Decimal(r.quantity);
        const reorder = r.reorder_level
          ? new Prisma.Decimal(r.reorder_level)
          : null;
        return {
          id: r.id,
          name: r.name,
          sku: r.sku,
          categoryId: r.category_id,
          categoryName: r.category_name,
          baseUnit: {
            id: r.base_id,
            name: r.base_name,
            allowFraction: r.base_allow_fraction,
          },
          retailPrice: r.retail_price
            ? new Prisma.Decimal(r.retail_price).toFixed(2)
            : null,
          wholesalePrice: r.wholesale_price
            ? new Prisma.Decimal(r.wholesale_price).toFixed(2)
            : null,
          quantity: showStock ? quantity.toFixed(3) : null,
          reorderLevel: reorder ? reorder.toFixed(3) : null,
          lowStock:
            showStock &&
            (quantity.isNegative() ||
              (reorder !== null && quantity.lte(reorder))),
          archived: r.archived_at !== null,
          matchedUnitId: r.matched_unit_id,
        };
      }),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ n: last.name, i: last.id })
          : null,
    };
  }

  async get(ctx: ShopContext, productId: string): Promise<ProductDetail> {
    const db = scopedToShop(this.prisma, ctx.shopId);
    const product = await db.product.findUnique({
      where: { id: productId },
      include: {
        category: { select: { name: true } },
        units: { orderBy: [{ isBase: 'desc' }, { conversion: 'asc' }] },
        balances: true,
        _count: { select: { movements: true } },
      },
    });
    if (!product) throw productNotFound();
    const canSeeCosts = this.authorization.canSeeCosts(ctx);
    const showStock = ctx.permissions.has('inventory.read');
    const quantity = product.balances.reduce(
      (sum, b) => sum.plus(b.quantity),
      new Prisma.Decimal(0),
    );
    const balance = product.balances[0];
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      categoryId: product.categoryId,
      categoryName: product.category?.name ?? null,
      reorderLevel: qty(product.reorderLevel),
      archived: product.archivedAt !== null,
      units: product.units.map((u) => this.unitView(u, canSeeCosts)),
      stock: {
        quantity: showStock ? quantity.toFixed(3) : null,
        averageCost:
          showStock && canSeeCosts && balance
            ? balance.averageCost.toFixed(4)
            : null,
        lowStock:
          showStock &&
          (quantity.isNegative() ||
            (product.reorderLevel !== null &&
              quantity.lte(product.reorderLevel))),
        hasMovements: product._count.movements > 0,
      },
      canSeeCosts,
      createdAt: product.createdAt.toISOString(),
    };
  }

  /**
   * Creates a product with its base unit, other units, prices and optional
   * opening stock in one transaction. Counts against the plan's product
   * limit; opening stock needs inventory.opening, buying prices need cost access.
   */
  async create(
    ctx: ShopContext,
    input: CreateProductInput,
    client: ClientInfo,
  ): Promise<ProductDetail> {
    const units = input.units ?? [];
    const all: (BaseUnitInput & { conversion: string; isBase: boolean })[] = [
      { ...input.baseUnit, conversion: '1', isBase: true },
      ...units.map((u) => ({ ...u, isBase: false })),
    ];
    this.assertPricePermissions(ctx, all);
    if (input.openingStock && !ctx.permissions.has('inventory.opening')) {
      throw new ForbiddenException({
        message: 'You do not have permission to enter opening stock.',
        code: 'permission_denied',
      });
    }
    this.validateUnits(all, input.baseUnit.allowFraction ?? false);
    const opening = input.openingStock
      ? all.find(
          (u) =>
            u.name.trim().toLowerCase() ===
            input.openingStock!.unitName.trim().toLowerCase(),
        )
      : undefined;
    if (input.openingStock && !opening) {
      throw new BadRequestException({
        message: 'Opening stock must be in one of the product’s units.',
        code: 'unit_not_found',
      });
    }

    const productId = newId();
    const limit = (await this.subscriptions.entitlements(ctx.shopId)).features
      .products.limit;
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        await this.assertProductLimit(db, ctx.shopId, limit);
        await this.assertCategory(db, input.categoryId);
        await db.product.create({
          data: {
            id: productId,
            shopId: ctx.shopId,
            name: input.name.trim(),
            categoryId: input.categoryId ?? null,
            sku: blank(input.sku) ?? null,
            reorderLevel: input.reorderLevel ?? null,
            createdByMembershipId: ctx.membershipId,
          },
        });
        const created: { id: string; input: (typeof all)[number] }[] = [];
        for (const u of all) {
          const id = newId();
          await db.productUnit.create({
            data: {
              id,
              shopId: ctx.shopId,
              productId,
              name: u.name.trim(),
              conversion: u.conversion,
              isBase: u.isBase,
              allowFraction: u.allowFraction ?? false,
              barcode: blank(u.barcode) ?? null,
              buyingPrice: u.buyingPrice ?? null,
              retailPrice: u.retailPrice ?? null,
              wholesalePrice: u.wholesalePrice ?? null,
            },
          });
          await this.recordPrices(db, ctx, id, u);
          created.push({ id, input: u });
        }
        let openingQuantity: string | null = null;
        if (input.openingStock && opening) {
          const unit = created.find((c) => c.input === opening)!;
          const movement = await this.inventory.recordOpening(db, ctx, {
            productId,
            unit: {
              id: unit.id,
              name: opening.name.trim(),
              conversion: opening.conversion,
              allowFraction: opening.allowFraction ?? false,
            },
            baseAllowsFraction: input.baseUnit.allowFraction ?? false,
            quantity: input.openingStock.quantity,
            unitCost: input.openingStock.unitCost,
          });
          openingQuantity = movement.quantity.toFixed(3);
        }
        await this.audit.record(
          {
            action: 'product.created',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'product',
            entityId: productId,
            after: {
              name: input.name.trim(),
              sku: blank(input.sku) ?? null,
              units: all.map((u) => ({
                name: u.name.trim(),
                conversion: u.conversion,
                retailPrice: u.retailPrice ?? null,
                wholesalePrice: u.wholesalePrice ?? null,
              })),
              openingStock: openingQuantity,
            },
            client,
          },
          db,
        );
      });
    } catch (err) {
      throw duplicateError(uniqueViolation(err)) ?? err;
    }
    return this.get(ctx, productId);
  }

  async update(
    ctx: ShopContext,
    productId: string,
    input: UpdateProductInput,
    client: ClientInfo,
  ): Promise<ProductDetail> {
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        const before = await db.product.findUnique({
          where: { id: productId },
        });
        if (!before) throw productNotFound();
        if (input.categoryId) await this.assertCategory(db, input.categoryId);
        const after = await db.product.update({
          where: { id: productId },
          data: {
            name: input.name?.trim(),
            categoryId: input.categoryId,
            sku: blank(input.sku),
            reorderLevel: input.reorderLevel,
          },
        });
        const snap = (p: typeof before) => ({
          name: p.name,
          categoryId: p.categoryId,
          sku: p.sku,
          reorderLevel: qty(p.reorderLevel),
        });
        await this.audit.record(
          {
            action: 'product.updated',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'product',
            entityId: productId,
            before: snap(before),
            after: snap(after),
            client,
          },
          db,
        );
      });
    } catch (err) {
      throw duplicateError(uniqueViolation(err)) ?? err;
    }
    return this.get(ctx, productId);
  }

  /**
   * Archives (hides from lists and stock changes) or restores a product.
   * A product with stock on record cannot be archived, so stock value never
   * hides in archived products; restoring counts against the plan limit.
   */
  async setArchived(
    ctx: ShopContext,
    productId: string,
    archived: boolean,
    client: ClientInfo,
  ): Promise<ProductDetail> {
    const limit = archived
      ? null
      : (await this.subscriptions.entitlements(ctx.shopId)).features.products
          .limit;
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      const product = await db.product.findUnique({
        where: { id: productId },
        include: { balances: true },
      });
      if (!product) throw productNotFound();
      if ((product.archivedAt !== null) === archived) return;
      if (archived && product.balances.some((b) => !b.quantity.isZero())) {
        throw new ConflictException({
          message:
            'This product still has stock on record. Adjust it to zero before archiving.',
          code: 'product_has_stock',
        });
      }
      if (!archived) await this.assertProductLimit(db, ctx.shopId, limit);
      await db.product.update({
        where: { id: productId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        {
          action: archived ? 'product.archived' : 'product.restored',
          shopId: ctx.shopId,
          actorUserId: ctx.userId,
          actorMembershipId: ctx.membershipId,
          entityType: 'product',
          entityId: productId,
          client,
        },
        db,
      );
    });
    return this.get(ctx, productId);
  }

  async addUnit(
    ctx: ShopContext,
    productId: string,
    input: UnitInput,
    client: ClientInfo,
  ): Promise<ProductDetail> {
    this.assertPricePermissions(ctx, [input]);
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        const product = await db.product.findUnique({
          where: { id: productId },
          include: { units: true },
        });
        if (!product) throw productNotFound();
        const base = product.units.find((u) => u.isBase)!;
        if (
          product.units.filter((u) => !u.archivedAt).length >=
          PRODUCT_LIMITS.unitsMax
        ) {
          throw new ConflictException({
            message: `A product can have at most ${PRODUCT_LIMITS.unitsMax} units.`,
            code: 'too_many_units',
          });
        }
        this.assertConversion(input.conversion, base.allowFraction);
        const id = newId();
        await db.productUnit.create({
          data: {
            id,
            shopId: ctx.shopId,
            productId,
            name: input.name.trim(),
            conversion: input.conversion,
            allowFraction: input.allowFraction ?? false,
            barcode: blank(input.barcode) ?? null,
            buyingPrice: input.buyingPrice ?? null,
            retailPrice: input.retailPrice ?? null,
            wholesalePrice: input.wholesalePrice ?? null,
          },
        });
        await this.recordPrices(db, ctx, id, input);
        await this.audit.record(
          {
            action: 'product.unit_added',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'product',
            entityId: productId,
            after: {
              unitId: id,
              name: input.name.trim(),
              conversion: input.conversion,
              barcode: blank(input.barcode) ?? null,
            },
            client,
          },
          db,
        );
      });
    } catch (err) {
      throw duplicateError(uniqueViolation(err)) ?? err;
    }
    return this.get(ctx, productId);
  }

  /**
   * Renames a unit, changes its barcode, or archives it. The conversion
   * never changes (archive the unit and add a new one instead), and the
   * base unit cannot be archived or change its fraction rule.
   */
  async updateUnit(
    ctx: ShopContext,
    productId: string,
    unitId: string,
    input: UpdateUnitInput,
    client: ClientInfo,
  ): Promise<ProductDetail> {
    try {
      await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
        const unit = await db.productUnit.findFirst({
          where: { id: unitId, productId },
        });
        if (!unit) throw unitNotFound();
        if (
          unit.isBase &&
          (input.archived === true ||
            (input.allowFraction !== undefined &&
              input.allowFraction !== unit.allowFraction))
        ) {
          throw new ConflictException({
            message:
              'The base unit cannot be archived and its whole-number rule cannot change.',
            code: 'base_unit_fixed',
          });
        }
        const after = await db.productUnit.update({
          where: { id: unitId },
          data: {
            name: input.name?.trim(),
            barcode: blank(input.barcode),
            allowFraction: input.allowFraction,
            archivedAt:
              input.archived === undefined
                ? undefined
                : input.archived
                  ? (unit.archivedAt ?? new Date())
                  : null,
          },
        });
        const snap = (u: ProductUnit) => ({
          name: u.name,
          barcode: u.barcode,
          allowFraction: u.allowFraction,
          archived: u.archivedAt !== null,
        });
        await this.audit.record(
          {
            action: 'product.unit_updated',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'product',
            entityId: productId,
            before: { unitId, ...snap(unit) },
            after: { unitId, ...snap(after) },
            client,
          },
          db,
        );
      });
    } catch (err) {
      throw duplicateError(uniqueViolation(err)) ?? err;
    }
    return this.get(ctx, productId);
  }

  /**
   * Replaces a unit's prices (products.prices.update). Each change adds a
   * price-history row and an audit entry; the old prices stay in history.
   */
  async setPrices(
    ctx: ShopContext,
    productId: string,
    unitId: string,
    input: PricesInput,
    client: ClientInfo,
  ): Promise<ProductDetail> {
    await scopedToShop(this.prisma, ctx.shopId).$transaction(async (db) => {
      const unit = await db.productUnit.findFirst({
        where: { id: unitId, productId },
      });
      if (!unit) throw unitNotFound();
      const next = {
        buyingPrice:
          input.buyingPrice === undefined
            ? money(unit.buyingPrice)
            : input.buyingPrice === null
              ? null
              : new Prisma.Decimal(input.buyingPrice).toFixed(2),
        retailPrice:
          input.retailPrice === undefined
            ? money(unit.retailPrice)
            : input.retailPrice === null
              ? null
              : new Prisma.Decimal(input.retailPrice).toFixed(2),
        wholesalePrice:
          input.wholesalePrice === undefined
            ? money(unit.wholesalePrice)
            : input.wholesalePrice === null
              ? null
              : new Prisma.Decimal(input.wholesalePrice).toFixed(2),
      };
      const before = {
        buyingPrice: money(unit.buyingPrice),
        retailPrice: money(unit.retailPrice),
        wholesalePrice: money(unit.wholesalePrice),
      };
      if (JSON.stringify(before) === JSON.stringify(next)) return;
      await db.productUnit.update({ where: { id: unitId }, data: next });
      await this.recordPrices(db, ctx, unitId, next, true);
      await this.audit.record(
        {
          action: 'product.prices_changed',
          shopId: ctx.shopId,
          actorUserId: ctx.userId,
          actorMembershipId: ctx.membershipId,
          entityType: 'product',
          entityId: productId,
          before: { unitId, ...before },
          after: { unitId, ...next },
          client,
        },
        db,
      );
    });
    return this.get(ctx, productId);
  }

  // ---- helpers ----

  private unitView(u: ProductUnit, canSeeCosts: boolean): UnitView {
    return {
      id: u.id,
      name: u.name,
      conversion: u.conversion.toFixed(3),
      isBase: u.isBase,
      allowFraction: u.allowFraction,
      barcode: u.barcode,
      buyingPrice: canSeeCosts ? money(u.buyingPrice) : null,
      retailPrice: money(u.retailPrice),
      wholesalePrice: money(u.wholesalePrice),
      archived: u.archivedAt !== null,
    };
  }

  /**
   * Initial selling prices come with products.create (or products.update for
   * a new unit); changing them later needs products.prices.update. Buying
   * prices always need cost access.
   */
  private assertPricePermissions(ctx: ShopContext, units: PricesInput[]): void {
    if (
      units.some((u) => u.buyingPrice) &&
      !this.authorization.canSeeCosts(ctx)
    ) {
      throw new ForbiddenException({
        message: 'You do not have permission to enter buying prices.',
        code: 'permission_denied',
      });
    }
  }

  private validateUnits(
    units: (BaseUnitInput & { conversion: string })[],
    baseAllowsFraction: boolean,
  ): void {
    const names = units.map((u) => u.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      throw new ConflictException({
        message: 'Each unit of a product needs a different name.',
        code: 'unit_name_taken',
      });
    }
    const barcodes = units
      .map((u) => blank(u.barcode))
      .filter((b): b is string => !!b);
    if (new Set(barcodes).size !== barcodes.length) {
      throw new ConflictException({
        message: 'Each unit needs a different barcode.',
        code: 'barcode_taken',
      });
    }
    for (const u of units)
      this.assertConversion(u.conversion, baseAllowsFraction);
  }

  private assertConversion(conversion: string, baseAllowsFraction: boolean) {
    if (!conversionFits(conversion, baseAllowsFraction)) {
      throw new BadRequestException({
        message:
          'The base unit is counted in whole numbers, so each unit must hold a whole number of base units.',
        code: 'conversion_not_whole',
      });
    }
  }

  /** Plan product limit (feature `products`), checked under a shop row lock. */
  private async assertProductLimit(
    db: ShopScopedTx,
    shopId: string,
    limit: number | null,
  ): Promise<void> {
    if (limit === null) return;
    await db.$queryRaw`SELECT id FROM shops WHERE id = ${shopId}::uuid FOR UPDATE`;
    const active = await db.product.count({ where: { archivedAt: null } });
    if (active >= limit) {
      throw new HttpException(
        {
          message: `Your plan allows ${limit} products. Archive products you no longer sell or change your plan.`,
          code: 'product_limit_reached',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  private async assertCategory(
    db: ShopScopedTx,
    categoryId: string | null | undefined,
  ): Promise<void> {
    if (!categoryId) return;
    const category = await db.productCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category || category.archivedAt) {
      throw new NotFoundException({
        message: 'Category not found.',
        code: 'category_not_found',
      });
    }
  }

  private async recordPrices(
    db: ShopScopedTx,
    ctx: ShopContext,
    unitId: string,
    prices: PricesInput,
    always = false,
  ): Promise<void> {
    if (
      !always &&
      !prices.buyingPrice &&
      !prices.retailPrice &&
      !prices.wholesalePrice
    ) {
      return;
    }
    await db.priceHistory.create({
      data: {
        id: newId(),
        shopId: ctx.shopId,
        productUnitId: unitId,
        buyingPrice: prices.buyingPrice ?? null,
        retailPrice: prices.retailPrice ?? null,
        wholesalePrice: prices.wholesalePrice ?? null,
        changedByMembershipId: ctx.membershipId,
      },
    });
  }
}
