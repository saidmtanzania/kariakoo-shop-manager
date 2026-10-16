import { Injectable } from '@nestjs/common';
import type { ShopDetails } from '@ksm/shared';
import type {
  AuthContext,
  ClientInfo,
  ShopContext,
} from '../../../common/auth/request-context.js';
import { newId } from '../../../common/ids/ids.js';
import {
  Prisma,
  PrismaService,
  scopedToShop,
  type Shop,
} from '../../../database/index.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { RolesService } from '../../authorization/services/roles.service.js';
import { SessionService } from '../../auth/services/session.service.js';
import type { CreateShopDto, UpdateShopDto } from '../dto/shop.dto.js';

const blankToNull = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export function toShopDetails(shop: Shop): ShopDetails {
  return {
    id: shop.id,
    name: shop.name,
    phone: shop.phone,
    address: shop.address,
    businessType: shop.businessType,
    timezone: shop.timezone,
    currency: shop.currency,
    status: shop.status,
  };
}

const snapshot = (shop: Shop) =>
  toShopDetails(shop) as unknown as Prisma.InputJsonObject;

@Injectable()
export class ShopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly roles: RolesService,
  ) {}

  /**
   * Creates a shop with the caller as its owner and makes it the session's
   * active shop, all in one transaction.
   */
  async create(
    auth: AuthContext,
    dto: CreateShopDto,
    client: ClientInfo,
  ): Promise<ShopDetails> {
    const shopId = newId();
    const shop = await this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          id: shopId,
          name: dto.name.trim(),
          phone: blankToNull(dto.phone) ?? null,
          address: blankToNull(dto.address) ?? null,
          businessType: dto.businessType ?? 'BOTH',
        },
      });
      const membership = await tx.shopMembership.create({
        data: { id: newId(), shopId, userId: auth.userId, isOwner: true },
      });
      await this.roles.createDefaults(shopId, tx);
      await this.sessions.setActiveShop(auth.sessionId, shopId, tx);
      await this.audit.record(
        {
          action: 'shop.created',
          shopId,
          actorUserId: auth.userId,
          actorMembershipId: membership.id,
          entityType: 'shop',
          entityId: shopId,
          after: snapshot(shop),
          client,
        },
        tx,
      );
      return shop;
    });
    return toShopDetails(shop);
  }

  async get(ctx: ShopContext): Promise<ShopDetails> {
    const shop = await scopedToShop(
      this.prisma,
      ctx.shopId,
    ).shop.findUniqueOrThrow({
      where: { id: ctx.shopId },
    });
    return toShopDetails(shop);
  }

  async update(
    ctx: ShopContext,
    dto: UpdateShopDto,
    client: ClientInfo,
  ): Promise<ShopDetails> {
    // The transaction runs on the scoped client, so every query in it is confined to the shop.
    const after = await scopedToShop(this.prisma, ctx.shopId).$transaction(
      async (db) => {
        const before = await db.shop.findUniqueOrThrow({
          where: { id: ctx.shopId },
        });
        const after = await db.shop.update({
          where: { id: ctx.shopId },
          data: {
            name: dto.name?.trim(),
            phone: blankToNull(dto.phone),
            address: blankToNull(dto.address),
            businessType: dto.businessType,
          },
        });
        await this.audit.record(
          {
            action: 'shop.updated',
            shopId: ctx.shopId,
            actorUserId: ctx.userId,
            actorMembershipId: ctx.membershipId,
            entityType: 'shop',
            entityId: ctx.shopId,
            before: snapshot(before),
            after: snapshot(after),
            client,
          },
          db,
        );
        return after;
      },
    );
    return toShopDetails(after);
  }
}
