import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PurchaseDetail, PurchaseListItem } from '@ksm/shared';
import {
  RequirePermission,
  RequireWritable,
} from '../../../common/auth/access.decorators.js';
import {
  Client,
  CurrentShop,
  type ClientInfo,
  type ShopContext,
} from '../../../common/auth/request-context.js';
import {
  CancelPurchaseDto,
  CreatePurchaseDto,
  ListPurchasesQueryDto,
  PurchaseBodyDto,
  ReceivePurchaseDto,
} from '../dto/purchase.dto.js';
import { PurchasesService } from '../services/purchases.service.js';

/**
 * Purchases of the active shop (D-014): a draft until the goods arrive,
 * then received as they arrived, which adds the stock and what the shop
 * owes the supplier.
 */
@ApiTags('purchases')
@Controller('shops/current/purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermission('purchases.read')
  list(
    @CurrentShop() shop: ShopContext,
    @Query() query: ListPurchasesQueryDto,
  ): Promise<{ purchases: PurchaseListItem[]; nextCursor: string | null }> {
    return this.purchases.list(shop, query);
  }

  @Post()
  @RequirePermission('purchases.create')
  @RequireWritable()
  create(
    @CurrentShop() shop: ShopContext,
    @Body() dto: CreatePurchaseDto,
    @Client() client: ClientInfo,
  ): Promise<PurchaseDetail> {
    return this.purchases.create(shop, dto, client);
  }

  @Get(':purchaseId')
  @RequirePermission('purchases.read')
  get(
    @CurrentShop() shop: ShopContext,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
  ): Promise<PurchaseDetail> {
    return this.purchases.get(shop, purchaseId);
  }

  /** Replaces a draft; received and cancelled purchases cannot change. */
  @Put(':purchaseId')
  @RequirePermission('purchases.create')
  @RequireWritable()
  update(
    @CurrentShop() shop: ShopContext,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
    @Body() dto: PurchaseBodyDto,
    @Client() client: ClientInfo,
  ): Promise<PurchaseDetail> {
    return this.purchases.update(shop, purchaseId, dto, client);
  }

  @Post(':purchaseId/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('purchases.receive')
  @RequireWritable()
  receive(
    @CurrentShop() shop: ShopContext,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
    @Body() dto: ReceivePurchaseDto,
    @Client() client: ClientInfo,
  ): Promise<PurchaseDetail> {
    return this.purchases.receive(shop, purchaseId, dto, client);
  }

  @Post(':purchaseId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('purchases.cancel')
  @RequireWritable()
  cancel(
    @CurrentShop() shop: ShopContext,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
    @Body() dto: CancelPurchaseDto,
    @Client() client: ClientInfo,
  ): Promise<PurchaseDetail> {
    return this.purchases.cancel(shop, purchaseId, dto.reason, client);
  }
}
