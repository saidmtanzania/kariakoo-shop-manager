import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryController } from './controllers/inventory.controller.js';
import { InventoryService } from './services/inventory.service.js';
import { StockLedgerService } from './services/stock-ledger.service.js';

/**
 * Stock locations, balances, the movement ledger and adjustments (Phase 05).
 * StockLedgerService is the only writer of balances and movements; other
 * modules (products now, purchases and sales later) go through it.
 */
@Module({
  imports: [AuthorizationModule],
  controllers: [InventoryController],
  providers: [InventoryService, StockLedgerService],
  exports: [InventoryService, StockLedgerService],
})
export class InventoryModule {}
