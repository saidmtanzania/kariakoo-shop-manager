import { Module } from '@nestjs/common';
import { RolesController } from './controllers/roles.controller.js';
import { AuthorizationService } from './services/authorization.service.js';
import { RolesService } from './services/roles.service.js';

@Module({
  controllers: [RolesController],
  providers: [AuthorizationService, RolesService],
  exports: [AuthorizationService, RolesService],
})
export class AuthorizationModule {}
