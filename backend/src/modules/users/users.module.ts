import { Module } from '@nestjs/common';
import { PasswordService } from './services/password.service.js';
import { UsersService } from './services/users.service.js';

@Module({
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
