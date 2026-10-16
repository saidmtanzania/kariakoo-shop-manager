import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SuppliersController } from './controllers/suppliers.controller.js';
import { SupplierLedgerService } from './services/supplier-ledger.service.js';
import { SuppliersService } from './services/suppliers.service.js';

/**
 * Suppliers, the supplier ledger and payments to suppliers (Phase 06).
 * SupplierLedgerService is the only writer of supplier balances and ledger
 * entries; purchases go through it.
 */
@Module({
  imports: [AuthorizationModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, SupplierLedgerService],
  exports: [SuppliersService, SupplierLedgerService],
})
export class SuppliersModule {}
