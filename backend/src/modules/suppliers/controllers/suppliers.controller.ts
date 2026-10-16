import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  SupplierEntryView,
  SupplierPaymentView,
  SupplierReconciliation,
  SupplierView,
} from '@ksm/shared';
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
  CreateSupplierDto,
  LedgerQueryDto,
  ListSuppliersQueryDto,
  ReasonDto,
  RecordSupplierPaymentDto,
  UpdateSupplierDto,
} from '../dto/supplier.dto.js';
import { SuppliersService } from '../services/suppliers.service.js';

/**
 * Suppliers of the active shop, their accounts and payments to them.
 * Adding and editing suppliers needs a writable subscription; recording
 * and reversing payments does not, like customer debt payments (D-005).
 */
@ApiTags('suppliers')
@Controller('shops/current/suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('suppliers.read')
  list(
    @CurrentShop() shop: ShopContext,
    @Query() query: ListSuppliersQueryDto,
  ): Promise<{ suppliers: SupplierView[]; nextCursor: string | null }> {
    return this.suppliers.list(shop, query);
  }

  @Post()
  @RequirePermission('suppliers.manage')
  @RequireWritable()
  create(
    @CurrentShop() shop: ShopContext,
    @Body() dto: CreateSupplierDto,
    @Client() client: ClientInfo,
  ): Promise<SupplierView> {
    return this.suppliers.create(shop, dto, client);
  }

  /** Stored balances compared with the supplier ledgers; should list none. */
  @Get('reconciliation')
  @RequirePermission('suppliers.read')
  reconciliation(
    @CurrentShop() shop: ShopContext,
  ): Promise<SupplierReconciliation> {
    return this.suppliers.reconciliation(shop);
  }

  @Get(':supplierId')
  @RequirePermission('suppliers.read')
  get(
    @CurrentShop() shop: ShopContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
  ): Promise<SupplierView> {
    return this.suppliers.get(shop, supplierId);
  }

  @Patch(':supplierId')
  @RequirePermission('suppliers.manage')
  @RequireWritable()
  update(
    @CurrentShop() shop: ShopContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() dto: UpdateSupplierDto,
    @Client() client: ClientInfo,
  ): Promise<SupplierView> {
    return this.suppliers.update(shop, supplierId, dto, client);
  }

  @Get(':supplierId/entries')
  @RequirePermission('suppliers.read')
  entries(
    @CurrentShop() shop: ShopContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Query() query: LedgerQueryDto,
  ): Promise<{ entries: SupplierEntryView[]; nextCursor: string | null }> {
    return this.suppliers.entries(shop, supplierId, query);
  }

  @Post(':supplierId/payments')
  @RequirePermission('supplier_payments.create')
  pay(
    @CurrentShop() shop: ShopContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() dto: RecordSupplierPaymentDto,
    @Client() client: ClientInfo,
  ): Promise<SupplierPaymentView> {
    return this.suppliers.recordPayment(shop, supplierId, dto, client);
  }

  /** Corrects a payment recorded by mistake (A-029). */
  @Post(':supplierId/payments/:paymentId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('purchases.cancel')
  reverse(
    @CurrentShop() shop: ShopContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ReasonDto,
    @Client() client: ClientInfo,
  ): Promise<SupplierPaymentView> {
    return this.suppliers.reversePayment(
      shop,
      supplierId,
      paymentId,
      dto.reason,
      client,
    );
  }
}
