import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { MembershipSummary, ShopDetails } from '@ksm/shared';
import {
  RequirePermission,
  ShopScoped,
  SignedIn,
} from '../../../common/auth/access.decorators.js';
import {
  Client,
  CurrentAuth,
  CurrentShop,
  type AuthContext,
  type ClientInfo,
  type ShopContext,
} from '../../../common/auth/request-context.js';
import { MembershipsService } from '../../memberships/services/memberships.service.js';
import { CreateShopDto, UpdateShopDto } from '../dto/shop.dto.js';
import { ShopsService } from '../services/shops.service.js';

/**
 * No route here takes a shop id: "current" always means the active shop
 * held in the server-side session.
 */
@ApiTags('shops')
@Controller('shops')
export class ShopsController {
  constructor(
    private readonly shops: ShopsService,
    private readonly memberships: MembershipsService,
  ) {}

  /** Any signed-in user can create a shop and becomes its owner. */
  @Post()
  @SignedIn()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateShopDto,
    @Client() client: ClientInfo,
  ): Promise<ShopDetails> {
    return this.shops.create(auth, dto, client);
  }

  /** Shops the signed-in user belongs to. */
  @Get()
  @SignedIn()
  async list(
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ shops: MembershipSummary[] }> {
    return { shops: await this.memberships.listForUser(auth.userId) };
  }

  @Get('current')
  @ShopScoped()
  current(@CurrentShop() shop: ShopContext): Promise<ShopDetails> {
    return this.shops.get(shop);
  }

  @Patch('current')
  @RequirePermission('settings.manage')
  update(
    @CurrentShop() shop: ShopContext,
    @Body() dto: UpdateShopDto,
    @Client() client: ClientInfo,
  ): Promise<ShopDetails> {
    return this.shops.update(shop, dto, client);
  }
}
