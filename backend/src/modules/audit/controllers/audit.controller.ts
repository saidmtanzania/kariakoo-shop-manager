import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuditEntryView } from '@ksm/shared';
import { RequirePermission } from '../../../common/auth/access.decorators.js';
import {
  CurrentShop,
  type ShopContext,
} from '../../../common/auth/request-context.js';
import { AuditQueryDto } from '../dto/audit-query.dto.js';
import { AuditService } from '../services/audit.service.js';

@ApiTags('audit')
@Controller('shops/current/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  list(
    @CurrentShop() shop: ShopContext,
    @Query() query: AuditQueryDto,
  ): Promise<{ entries: AuditEntryView[]; nextCursor: string | null }> {
    return this.audit.listForShop(shop, query);
  }
}
