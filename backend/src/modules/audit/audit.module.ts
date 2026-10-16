import { Global, Module } from '@nestjs/common';
import { AuditController } from './controllers/audit.controller.js';
import { AuditService } from './services/audit.service.js';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
