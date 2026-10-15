import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './controllers/auth.controller.js';
import { AccessGuard } from './guards/access.guard.js';
import { AuthTokensService } from './services/auth-tokens.service.js';
import { AuthService } from './services/auth.service.js';
import { SessionService } from './services/session.service.js';

@Module({
  imports: [UsersModule, MembershipsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokensService,
    SessionService,
    // The only global guard; see AccessGuard for the order of checks.
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
