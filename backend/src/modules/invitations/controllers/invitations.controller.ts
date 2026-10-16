import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { InvitationPreview, InvitationView } from '@ksm/shared';
import {
  Public,
  RequirePermission,
  RequireWritable,
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
  RateLimit,
  RateLimitGuard,
} from '../../../common/rate-limit/rate-limit.guard.js';
import {
  CreateInvitationDto,
  InvitationTokenDto,
} from '../dto/invitation.dto.js';
import { InvitationsService } from '../services/invitations.service.js';

/** Managing the active shop's invitations. */
@ApiTags('invitations')
@Controller('shops/current/invitations')
@UseGuards(RateLimitGuard)
export class ShopInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequirePermission('users.read')
  async list(
    @CurrentShop() shop: ShopContext,
  ): Promise<{ invitations: InvitationView[] }> {
    return { invitations: await this.invitations.list(shop) };
  }

  @Post()
  @RequirePermission('users.invite')
  @RequireWritable()
  @RateLimit({ name: 'invite', limit: 50, windowSeconds: 3600, by: 'ip' })
  create(
    @CurrentShop() shop: ShopContext,
    @Body() dto: CreateInvitationDto,
    @Client() client: ClientInfo,
  ): Promise<InvitationView> {
    return this.invitations.create(shop, dto, client);
  }

  @Post(':invitationId/resend')
  @RequirePermission('users.invite')
  @RequireWritable()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'invite', limit: 50, windowSeconds: 3600, by: 'ip' })
  resend(
    @CurrentShop() shop: ShopContext,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Client() client: ClientInfo,
  ): Promise<InvitationView> {
    return this.invitations.resend(shop, invitationId, client);
  }

  @Post(':invitationId/revoke')
  @RequirePermission('users.invite')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentShop() shop: ShopContext,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Client() client: ClientInfo,
  ): Promise<InvitationView> {
    return this.invitations.revoke(shop, invitationId, client);
  }
}

/** The invitee's side, reached through the emailed link. */
@ApiTags('invitations')
@Controller('invitations')
@UseGuards(RateLimitGuard)
export class InvitationAcceptanceController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('preview')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    name: 'invitation-preview',
    limit: 30,
    windowSeconds: 3600,
    by: 'ip',
  })
  preview(@Body() dto: InvitationTokenDto): Promise<InvitationPreview> {
    return this.invitations.preview(dto.token);
  }

  @Post('accept')
  @SignedIn()
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    name: 'invitation-accept',
    limit: 20,
    windowSeconds: 3600,
    by: 'ip',
  })
  accept(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: InvitationTokenDto,
    @Client() client: ClientInfo,
  ): Promise<{ shopId: string }> {
    return this.invitations.accept(auth, dto.token, client);
  }
}
