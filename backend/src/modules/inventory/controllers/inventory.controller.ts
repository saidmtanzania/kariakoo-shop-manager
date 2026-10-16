import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  InventorySummary,
  ReconciliationResult,
  StockMovementView,
} from '@ksm/shared';
import {
  OwnerOnly,
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
  AdjustmentDto,
  InventorySettingsDto,
  MovementsQueryDto,
  OpeningStockDto,
} from '../dto/inventory.dto.js';
import {
  InventoryService,
  type AdjustmentResult,
} from '../services/inventory.service.js';

/** Stock records of the active shop. Changing stock needs a writable subscription. */
@ApiTags('inventory')
@Controller('shops/current')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('inventory/summary')
  @RequirePermission('inventory.read')
  summary(@CurrentShop() shop: ShopContext): Promise<InventorySummary> {
    return this.inventory.summary(shop);
  }

  @Get('inventory/movements')
  @RequirePermission('inventory.read')
  movements(
    @CurrentShop() shop: ShopContext,
    @Query() query: MovementsQueryDto,
  ): Promise<{ movements: StockMovementView[]; nextCursor: string | null }> {
    return this.inventory.movements(shop, query);
  }

  @Post('inventory/adjustments')
  @RequirePermission('inventory.adjust')
  @RequireWritable()
  adjust(
    @CurrentShop() shop: ShopContext,
    @Body() dto: AdjustmentDto,
    @Client() client: ClientInfo,
  ): Promise<AdjustmentResult> {
    return this.inventory.adjust(shop, dto, client);
  }

  @Post('products/:productId/opening-stock')
  @RequirePermission('inventory.opening')
  @RequireWritable()
  opening(
    @CurrentShop() shop: ShopContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: OpeningStockDto,
    @Client() client: ClientInfo,
  ): Promise<StockMovementView> {
    return this.inventory.opening(shop, productId, dto, client);
  }

  /** Balances compared with the movement ledger; should list no mismatches. */
  @Get('inventory/reconciliation')
  @RequirePermission('inventory.read')
  reconciliation(
    @CurrentShop() shop: ShopContext,
  ): Promise<ReconciliationResult> {
    return this.inventory.reconciliation(shop);
  }

  @Get('inventory/settings')
  @RequirePermission('inventory.read')
  settings(
    @CurrentShop() shop: ShopContext,
  ): Promise<{ allowNegativeStock: boolean }> {
    return this.inventory.settings(shop);
  }

  /** Whether sales may take stock below zero (D-007): the owner decides. */
  @Put('inventory/settings')
  @OwnerOnly()
  @RequireWritable()
  updateSettings(
    @CurrentShop() shop: ShopContext,
    @Body() dto: InventorySettingsDto,
    @Client() client: ClientInfo,
  ): Promise<{ allowNegativeStock: boolean }> {
    return this.inventory.updateSettings(shop, dto, client);
  }
}
