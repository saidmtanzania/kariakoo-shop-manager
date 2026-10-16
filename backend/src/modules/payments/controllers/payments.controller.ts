import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PaymentView, PlatformPaymentView } from '@ksm/shared';
import type { Request } from 'express';
import {
  PlatformAdmin,
  Public,
  RequirePermission,
  SkipCsrf,
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
  RateLimit,
  RateLimitGuard,
} from '../../../common/rate-limit/rate-limit.guard.js';
import {
  PaymentDecisionDto,
  PaymentListQueryDto,
  SubmitPaymentDto,
} from '../dto/payment.dto.js';
import { CallbacksService } from '../services/callbacks.service.js';
import { PaymentsService } from '../services/payments.service.js';
import { ReconciliationService } from '../services/reconciliation.service.js';

/**
 * A shop paying for its subscription. Allowed while read-only, since paying
 * is how a restricted shop gets access back.
 */
@ApiTags('subscription')
@Controller('shops/current/subscription/payments')
@UseGuards(RateLimitGuard)
export class ShopPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @RequirePermission('subscription.manage')
  @RateLimit({
    name: 'subscription-payment',
    limit: 20,
    windowSeconds: 3600,
    by: 'ip',
  })
  submit(
    @CurrentShop() shop: ShopContext,
    @Body() dto: SubmitPaymentDto,
    @Client() client: ClientInfo,
  ): Promise<PaymentView> {
    return this.payments.submit(shop, dto, client);
  }
}

/**
 * Server-to-server callbacks from payment providers. Public and exempt from
 * the CSRF header because providers cannot send it; every callback must
 * instead carry a signature the provider adapter verifies.
 */
@ApiTags('payments')
@Controller('payments/callbacks')
@UseGuards(RateLimitGuard)
export class PaymentCallbacksController {
  constructor(private readonly callbacks: CallbacksService) {}

  @Post(':provider')
  @Public()
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    name: 'payment-callback',
    limit: 600,
    windowSeconds: 60,
    by: 'ip',
  })
  receive(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.callbacks.receive(provider, req.headers, req.rawBody);
  }
}

/** Platform staff: checking and deciding payments. */
@ApiTags('platform')
@Controller('platform/payments')
export class PlatformPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get()
  @PlatformAdmin()
  async list(
    @Query() query: PaymentListQueryDto,
  ): Promise<{ payments: PlatformPaymentView[] }> {
    return {
      payments: await this.payments.listForPlatform(
        query.filter ?? 'attention',
      ),
    };
  }

  @Post(':paymentId/confirm')
  @PlatformAdmin()
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: PaymentDecisionDto,
    @Client() client: ClientInfo,
  ): Promise<PlatformPaymentView> {
    return this.payments.confirmByPlatform(auth, paymentId, dto.note, client);
  }

  @Post(':paymentId/reject')
  @PlatformAdmin()
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: PaymentDecisionDto,
    @Client() client: ClientInfo,
  ): Promise<PlatformPaymentView> {
    return this.payments.rejectByPlatform(auth, paymentId, dto.note, client);
  }

  @Post(':paymentId/reverse')
  @PlatformAdmin()
  @HttpCode(HttpStatus.OK)
  reverse(
    @CurrentAuth() auth: AuthContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: PaymentDecisionDto,
    @Client() client: ClientInfo,
  ): Promise<PlatformPaymentView> {
    return this.payments.reverseByPlatform(auth, paymentId, dto.note, client);
  }

  /** Asks providers about overdue pending payments now. */
  @Post('reconcile')
  @PlatformAdmin()
  @HttpCode(HttpStatus.OK)
  reconcile(): Promise<{ checked: number; changed: number }> {
    return this.reconciliation.run();
  }
}
