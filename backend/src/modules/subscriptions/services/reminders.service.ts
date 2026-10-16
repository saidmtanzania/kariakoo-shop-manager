import { Injectable, Logger } from '@nestjs/common';
import { subscriptionStatus } from '@ksm/shared';
import { PrismaService, scopedToShop } from '../../../database/index.js';
import { MailService } from '../../../mail/mail.service.js';
import {
  subscriptionExpiredMessage,
  subscriptionExpiringMessage,
} from '../../../mail/templates.js';
import { OutboxService } from '../../../outbox/outbox.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

const DAY_MS = 86_400_000;

interface DueRow {
  subscription_id: string;
  shop_id: string;
  shop_name: string;
  access_ends_at: Date;
}

/**
 * Expiry reminders (decision D-019): one email to the shop's owners
 * reminderDaysBefore days before full access ends, and one on the day it
 * ends. Each is recorded in subscription_reminders, keyed by the end date,
 * so it is sent once however often the job runs; a new payment moves the
 * end date, which makes the next reminders due again.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly outbox: OutboxService,
    private readonly mail: MailService,
  ) {}

  /** Queues every reminder due at `now`; returns how many were queued. */
  async run(now = new Date()): Promise<number> {
    const settings = await this.subscriptions.settings();
    const horizon = new Date(
      now.getTime() + settings.reminderDaysBefore * DAY_MS,
    );
    const yesterday = new Date(now.getTime() - DAY_MS);
    // Full access ends at the later of the trial end and paid-until.
    const rows = await this.prisma.$queryRaw<DueRow[]>`
      SELECT s.id AS subscription_id, s.shop_id, sh.name AS shop_name,
             GREATEST(s.trial_ends_at, COALESCE(s.paid_until, s.trial_ends_at)) AS access_ends_at
      FROM subscriptions s
      JOIN shops sh ON sh.id = s.shop_id
      WHERE sh.status <> 'SUSPENDED'
        AND GREATEST(s.trial_ends_at, COALESCE(s.paid_until, s.trial_ends_at))
            BETWEEN ${yesterday} AND ${horizon}`;
    let queued = 0;
    for (const row of rows) {
      const kind = row.access_ends_at > now ? 'expiring' : 'expired';
      try {
        if (await this.send(row, kind, now)) queued += 1;
      } catch (err) {
        this.logger.error({ err, shopId: row.shop_id }, 'Reminder failed');
      }
    }
    return queued;
  }

  private async send(
    row: DueRow,
    kind: 'expiring' | 'expired',
    now: Date,
  ): Promise<boolean> {
    return scopedToShop(this.prisma, row.shop_id).$transaction(async (db) => {
      const { count } = await db.subscriptionReminder.createMany({
        data: [
          {
            subscriptionId: row.subscription_id,
            shopId: row.shop_id,
            kind,
            dueAt: row.access_ends_at,
          },
        ],
        skipDuplicates: true,
      });
      if (count !== 1) return false;
      const sub = await db.subscription.findUniqueOrThrow({
        where: { id: row.subscription_id },
      });
      const status = subscriptionStatus(sub, now);
      const trial = !sub.paidUntil || sub.paidUntil <= sub.trialEndsAt;
      const url = this.mail.link('/subscription');
      for (const email of await this.subscriptions.ownerEmails(db)) {
        await this.outbox.enqueueEmail(
          kind === 'expiring'
            ? subscriptionExpiringMessage(
                email,
                row.shop_name,
                row.access_ends_at,
                trial,
                url,
              )
            : subscriptionExpiredMessage(
                email,
                row.shop_name,
                trial ? null : status.graceEndsAt,
                url,
              ),
          { db, shopId: row.shop_id },
        );
      }
      return true;
    });
  }
}
