import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { PurchasesController } from './controllers/purchases.controller.js';
import { PurchasesService } from './services/purchases.service.js';

/**
 * Purchases and receiving (Phase 06). Stock changes go through the stock
 * ledger and supplier balances through the supplier ledger.
 */
@Module({
  imports: [InventoryModule, SuppliersModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
