import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CategoryView, ProductDetail, ProductListItem } from '@ksm/shared';
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
  CategoryDto,
  CreateProductDto,
  ListProductsQueryDto,
  PricesDto,
  UnitDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateUnitDto,
} from '../dto/product.dto.js';
import { CategoriesService } from '../services/categories.service.js';
import { ProductsService } from '../services/products.service.js';

/**
 * Products of the active shop. Every change needs a writable subscription
 * (read-only shops can still look things up).
 */
@ApiTags('products')
@Controller('shops/current')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  @Get('products')
  @RequirePermission('products.read')
  list(
    @CurrentShop() shop: ShopContext,
    @Query() query: ListProductsQueryDto,
  ): Promise<{ products: ProductListItem[]; nextCursor: string | null }> {
    return this.products.list(shop, query);
  }

  @Post('products')
  @RequirePermission('products.create')
  @RequireWritable()
  create(
    @CurrentShop() shop: ShopContext,
    @Body() dto: CreateProductDto,
    @Client() client: ClientInfo,
  ): Promise<ProductDetail> {
    return this.products.create(shop, dto, client);
  }

  @Get('products/:productId')
  @RequirePermission('products.read')
  get(
    @CurrentShop() shop: ShopContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductDetail> {
    return this.products.get(shop, productId);
  }

  @Patch('products/:productId')
  @RequirePermission('products.update')
  @RequireWritable()
  update(
    @CurrentShop() shop: ShopContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
    @Client() client: ClientInfo,
  ): Promise<ProductDetail> {
    return this.products.update(shop, productId, dto, client);
  }

  @Post('products/:productId/archive')
  @RequirePermission('products.archive')
  @RequireWritable()
  archive(
    @CurrentShop() shop: ShopContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Client() client: ClientInfo,
  ): Promise<ProductDetail> {
    return this.products.setArchived(shop, productId, true, client);
  }

  @Post('products/:productId/restore')
  @RequirePermission('products.archive')
  @RequireWritable()
  restore(
    @CurrentShop() shop: ShopContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Client() client: ClientInfo,
  ): Promise<ProductDetail> {
    return this.products.setArchived(shop, productId, false, client);
  }

  @Post('products/:productId/units')
  @RequirePermission('products.update')
  @RequireWritable()
  addUnit(
    @CurrentShop() shop: ShopContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UnitDto,
    @Client() client: ClientInfo,
  ): Promise<ProductDetail> {
    return this.products.addUnit(shop, productId, dto, client);
  }

  @Patch('products/:productId/units/:unitId')
  @RequirePermission('products.update')
  @RequireWritable()
  updateUnit(
    @CurrentShop() shop: ShopContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: UpdateUnitDto,
    @Client() client: ClientInfo,
  ): Promise<ProductDetail> {
    return this.products.updateUnit(shop, productId, unitId, dto, client);
  }

  @Put('products/:productId/units/:unitId/prices')
  @RequirePermission('products.prices.update')
  @RequireWritable()
  setPrices(
    @CurrentShop() shop: ShopContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: PricesDto,
    @Client() client: ClientInfo,
  ): Promise<ProductDetail> {
    return this.products.setPrices(shop, productId, unitId, dto, client);
  }

  @Get('product-categories')
  @RequirePermission('products.read')
  async listCategories(
    @CurrentShop() shop: ShopContext,
  ): Promise<{ categories: CategoryView[] }> {
    return { categories: await this.categories.list(shop) };
  }

  @Post('product-categories')
  @RequirePermission('products.update')
  @RequireWritable()
  createCategory(
    @CurrentShop() shop: ShopContext,
    @Body() dto: CategoryDto,
    @Client() client: ClientInfo,
  ): Promise<CategoryView> {
    return this.categories.create(shop, dto.name, client);
  }

  @Patch('product-categories/:categoryId')
  @RequirePermission('products.update')
  @RequireWritable()
  updateCategory(
    @CurrentShop() shop: ShopContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateCategoryDto,
    @Client() client: ClientInfo,
  ): Promise<CategoryView> {
    return this.categories.update(shop, categoryId, dto, client);
  }
}
