import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/env.schema.js';
import { newId } from '../../../common/ids/ids.js';
import { PaymentStatus, PrismaService } from '../../../database/index.js';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { PaymentsService } from './payments.service.js';

const BATCH = 50;

/**
 * Catches callbacks that never arrived: asks the provider about payments
 * still pending after PAYMENT_RECONCILE_AFTER_MINUTES. Provider requests are
 * made outside any transaction; the answer goes through the same rules as a
 * callback. Manual payments have no provider to ask; they wait for platform
 * staff, who see every pending payment on the platform screen.
 */
@Injectable()
export class ReconciliationService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ReconciliationService.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly payments: PaymentsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.SUBSCRIPTION_JOBS === 'off') return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.run()
        .catch((err: unknown) =>
          this.logger.error({ err }, 'Reconciliation failed'),
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

  /** Checks due payments once; returns how many changed. */
  async run(now = new Date()): Promise<{ checked: number; changed: number }> {
    const askable = this.providers
      .all()
      .filter((p) => p.fetchStatus)
      .map((p) => p.key);
    if (askable.length === 0) return { checked: 0, changed: 0 };
    const cutoff = new Date(
      now.getTime() - this.config.PAYMENT_RECONCILE_AFTER_MINUTES * 60_000,
    );
    // A platform job across shops: each payment is then handled scoped to its shop.
    const due = await this.prisma.subscriptionPayment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        provider: { in: askable },
        createdAt: { lte: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { provider: true, providerReference: true },
    });
    let changed = 0;
    for (const payment of due) {
      const provider = this.providers.get(payment.provider)!;
      try {
        const update = await provider.fetchStatus!(payment.providerReference);
        if (!update || update.status === 'PENDING') continue;
        const { outcome, paymentId } = await this.payments.applyProviderUpdate(
          payment.provider,
          update,
          'reconciliation',
        );
        await this.prisma.paymentEvent.createMany({
          data: [
            {
              id: newId(),
              provider: payment.provider,
              providerEventId:
                `reconcile:${update.reference}:${update.status}`.slice(0, 120),
              payload: { ...update },
              signatureValid: true,
              outcome,
              paymentId,
              processedAt: new Date(),
            },
          ],
          skipDuplicates: true,
        });
        if (
          [
            'confirmed',
            'failed',
            'reversed',
            'amount_mismatch',
            'flagged',
          ].includes(outcome)
        ) {
          changed += 1;
        }
      } catch (err) {
        this.logger.warn(
          { err, provider: payment.provider },
          'Could not reconcile a payment',
        );
      }
    }
    return { checked: due.length, changed };
  }
}
