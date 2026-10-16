import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { ProductsController } from './controllers/products.controller.js';
import { CategoriesService } from './services/categories.service.js';
import { ProductsService } from './services/products.service.js';

/** Categories, products, units and prices (Phase 05). */
@Module({
  imports: [AuthorizationModule, InventoryModule, SubscriptionsModule],
  controllers: [ProductsController],
  providers: [ProductsService, CategoriesService],
})
export class ProductsModule {}
