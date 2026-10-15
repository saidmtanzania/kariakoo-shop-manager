import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { OutboxWorker } from './outbox.worker.js';

@Global()
@Module({
  providers: [OutboxService, OutboxWorker],
  exports: [OutboxService, OutboxWorker],
})
export class OutboxModule {}
