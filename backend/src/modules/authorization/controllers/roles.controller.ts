import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PermissionInfo, RoleView } from '@ksm/shared';
import {
  RequirePermission,
  ShopScoped,
} from '../../../common/auth/access.decorators.js';
import {
  Client,
  CurrentShop,
  type ClientInfo,
  type ShopContext,
} from '../../../common/auth/request-context.js';
import { RoleDto } from '../dto/role.dto.js';
import { RolesService } from '../services/roles.service.js';

@ApiTags('roles')
@Controller('shops/current')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** The shop-level permission catalog (platform permissions are never listed). */
  @Get('permissions')
  @ShopScoped()
  permissions(): { permissions: PermissionInfo[] } {
    return { permissions: this.roles.catalog() };
  }

  @Get('roles')
  @RequirePermission('users.read')
  async list(@CurrentShop() shop: ShopContext): Promise<{ roles: RoleView[] }> {
    return { roles: await this.roles.list(shop) };
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  create(
    @CurrentShop() shop: ShopContext,
    @Body() dto: RoleDto,
    @Client() client: ClientInfo,
  ): Promise<RoleView> {
    return this.roles.create(shop, dto, client);
  }

  @Put('roles/:roleId')
  @RequirePermission('roles.manage')
  update(
    @CurrentShop() shop: ShopContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: RoleDto,
    @Client() client: ClientInfo,
  ): Promise<RoleView> {
    return this.roles.update(shop, roleId, dto, client);
  }

  @Delete('roles/:roleId')
  @RequirePermission('roles.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentShop() shop: ShopContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.roles.remove(shop, roleId, client);
  }
}
