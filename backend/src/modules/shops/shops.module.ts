import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { ShopsController } from './controllers/shops.controller.js';
import { ShopsService } from './services/shops.service.js';

@Module({
  imports: [AuthModule, MembershipsModule, AuthorizationModule],
  controllers: [ShopsController],
  providers: [ShopsService],
})
export class ShopsModule {}
