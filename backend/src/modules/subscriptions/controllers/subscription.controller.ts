import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  BillingSettingsView,
  PlanView,
  SubscriptionView,
} from '@ksm/shared';
import {
  PlatformAdmin,
  RequirePermission,
  SignedIn,
} from '../../../common/auth/access.decorators.js';
import {
  Client,
  CurrentAuth,
  CurrentShop,
  type AuthContext,
  type ClientInfo,
  type ShopContext,
} from '../../../common/auth/request-context.js';
import {
  BillingSettingsDto,
  CreatePlanDto,
  UpdatePlanDto,
} from '../dto/plan.dto.js';
import { PlansService } from '../services/plans.service.js';
import { SubscriptionsService } from '../services/subscriptions.service.js';

/** The active shop's subscription. Readable even when the shop is read-only. */
@ApiTags('subscription')
@Controller('shops/current/subscription')
export class ShopSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermission('subscription.read')
  get(@CurrentShop() shop: ShopContext): Promise<SubscriptionView> {
    return this.subscriptions.view(shop);
  }
}

/** Plans a shop can choose (prices are public to signed-in users). */
@ApiTags('subscription')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @SignedIn()
  async list(): Promise<{ plans: PlanView[] }> {
    return { plans: await this.plans.listActive() };
  }
}

/** Platform staff: the price list and billing settings. */
@ApiTags('platform')
@Controller('platform')
export class PlatformPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get('plans')
  @PlatformAdmin()
  async list(): Promise<{ plans: PlanView[] }> {
    return { plans: await this.plans.listAll() };
  }

  @Post('plans')
  @PlatformAdmin()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreatePlanDto,
    @Client() client: ClientInfo,
  ): Promise<PlanView> {
    return this.plans.create(auth, dto, client);
  }

  @Patch('plans/:planId')
  @PlatformAdmin()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: UpdatePlanDto,
    @Client() client: ClientInfo,
  ): Promise<PlanView> {
    return this.plans.update(auth, planId, dto, client);
  }

  @Get('billing-settings')
  @PlatformAdmin()
  settings(): Promise<BillingSettingsView> {
    return this.plans.getSettings();
  }

  @Put('billing-settings')
  @PlatformAdmin()
  updateSettings(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: BillingSettingsDto,
    @Client() client: ClientInfo,
  ): Promise<BillingSettingsView> {
    return this.plans.updateSettings(auth, dto, client);
  }
}
