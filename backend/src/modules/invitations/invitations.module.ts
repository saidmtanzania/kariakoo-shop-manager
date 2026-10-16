import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import {
  InvitationAcceptanceController,
  ShopInvitationsController,
} from './controllers/invitations.controller.js';
import { InvitationsService } from './services/invitations.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [ShopInvitationsController, InvitationAcceptanceController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
