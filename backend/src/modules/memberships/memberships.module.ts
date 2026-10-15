import { Module } from '@nestjs/common';
import { MembersController } from './controllers/members.controller.js';
import { MembershipsService } from './services/memberships.service.js';

@Module({
  controllers: [MembersController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
