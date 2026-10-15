import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { MemberView } from '@ksm/shared';
import {
  OwnerOnly,
  RequirePermission,
} from '../../../common/auth/access.decorators.js';
import {
  Client,
  CurrentShop,
  type ClientInfo,
  type ShopContext,
} from '../../../common/auth/request-context.js';
import { MembershipStatus } from '../../../database/index.js';
import { SetOwnerDto, SetRolesDto, SetStatusDto } from '../dto/member.dto.js';
import { MembershipsService } from '../services/memberships.service.js';

@ApiTags('members')
@Controller('shops/current/members')
export class MembersController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @RequirePermission('users.read')
  async list(
    @CurrentShop() shop: ShopContext,
  ): Promise<{ members: MemberView[] }> {
    return { members: await this.memberships.listMembers(shop) };
  }

  @Put(':membershipId/roles')
  @RequirePermission('users.manage')
  setRoles(
    @CurrentShop() shop: ShopContext,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: SetRolesDto,
    @Client() client: ClientInfo,
  ): Promise<MemberView> {
    return this.memberships.setRoles(shop, membershipId, dto.roleIds, client);
  }

  @Put(':membershipId/status')
  @RequirePermission('users.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setStatus(
    @CurrentShop() shop: ShopContext,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: SetStatusDto,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.memberships.setStatus(shop, membershipId, dto.status, client);
  }

  @Delete(':membershipId')
  @RequirePermission('users.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentShop() shop: ShopContext,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.memberships.setStatus(
      shop,
      membershipId,
      MembershipStatus.REMOVED,
      client,
    );
  }

  @Put(':membershipId/owner')
  @OwnerOnly()
  setOwner(
    @CurrentShop() shop: ShopContext,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: SetOwnerDto,
    @Client() client: ClientInfo,
  ): Promise<MemberView> {
    return this.memberships.setOwner(shop, membershipId, dto.isOwner, client);
  }
}
