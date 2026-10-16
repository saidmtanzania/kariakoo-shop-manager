import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/env.schema.js';
import { RemindersService } from './reminders.service.js';

/** Runs expiry reminders in-process (SUBSCRIPTION_JOBS=on). */
@Injectable()
export class ReminderJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReminderJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly reminders: RemindersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.SUBSCRIPTION_JOBS === 'off') return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.reminders
        .run()
        .catch((err: unknown) =>
          this.logger.error({ err }, 'Reminder job failed'),
        )
        .finally(() => {
          this.running = null;
        });
    }, this.config.SUBSCRIPTION_JOBS_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }
}
