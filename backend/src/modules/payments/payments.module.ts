import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import {
  PaymentCallbacksController,
  PlatformPaymentsController,
  ShopPaymentsController,
} from './controllers/payments.controller.js';
import { ManualProvider } from './providers/manual.provider.js';
import { ProviderRegistry } from './providers/provider-registry.js';
import { SandboxProvider } from './providers/sandbox.provider.js';
import { CallbacksService } from './services/callbacks.service.js';
import { PaymentsService } from './services/payments.service.js';
import { ReconciliationService } from './services/reconciliation.service.js';

/** Subscription payments: manual confirmation, provider adapters, callbacks, reconciliation. */
@Module({
  imports: [SubscriptionsModule],
  controllers: [
    ShopPaymentsController,
    PaymentCallbacksController,
    PlatformPaymentsController,
  ],
  providers: [
    ManualProvider,
    SandboxProvider,
    ProviderRegistry,
    PaymentsService,
    CallbacksService,
    ReconciliationService,
  ],
  exports: [SandboxProvider, ReconciliationService],
})
export class PaymentsModule {}
