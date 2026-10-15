import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ShopScoped } from '../../../common/auth/access.decorators.js';
import {
  CurrentShop,
  type ShopContext,
} from '../../../common/auth/request-context.js';
import {
  MembershipsService,
  type MemberView,
} from '../services/memberships.service.js';

@ApiTags('shops')
@Controller('shops/current/members')
export class MembersController {
  constructor(private readonly memberships: MembershipsService) {}

  /** Members of the active shop. Invitations and role changes arrive in Phase 03. */
  @Get()
  @ShopScoped()
  list(@CurrentShop() shop: ShopContext): Promise<{ members: MemberView[] }> {
    return this.memberships.listMembers(shop).then((members) => ({ members }));
  }
}
