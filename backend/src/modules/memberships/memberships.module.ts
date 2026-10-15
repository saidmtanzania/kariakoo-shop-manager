import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { MembersController } from './controllers/members.controller.js';
import { MembershipsService } from './services/memberships.service.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [MembersController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
