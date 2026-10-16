import { Module } from '@nestjs/common';
import {
  PlansController,
  PlatformPlansController,
  ShopSubscriptionController,
} from './controllers/subscription.controller.js';
import { PlansService } from './services/plans.service.js';
import { ReminderJob } from './services/reminder.job.js';
import { RemindersService } from './services/reminders.service.js';
import { SubscriptionsService } from './services/subscriptions.service.js';

/**
 * Plans, subscription status, entitlements and expiry reminders (Phase 04).
 * Depends on no other business module, so the access guard, shops and
 * invitations can all use it.
 */
@Module({
  controllers: [
    ShopSubscriptionController,
    PlansController,
    PlatformPlansController,
  ],
  providers: [
    SubscriptionsService,
    PlansService,
    RemindersService,
    ReminderJob,
  ],
  exports: [SubscriptionsService, RemindersService],
})
export class SubscriptionsModule {}
