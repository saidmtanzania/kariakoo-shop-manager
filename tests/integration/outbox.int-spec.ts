import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { MailService } from '../../backend/src/mail/mail.service.js';
import { OutboxService } from '../../backend/src/outbox/outbox.service.js';
import {
  MAX_ATTEMPTS,
  OutboxWorker,
} from '../../backend/src/outbox/outbox.worker.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/auth.js';

/** Email outbox (decision A-007): queued with the change, delivered with retries. */
describe('Outbox (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let worker: OutboxWorker;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    worker = app.get(OutboxWorker);
  });
  beforeEach(() => resetDatabase(app));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => app.close());

  const message = (to: string) => ({
    to,
    subject: 'Hello',
    text: 'secret #token=abc',
    html: '<p>secret</p>',
  });
  /** Makes retried rows due now instead of after the backoff. */
  const makeDue = () =>
    prisma.outboxMessage.updateMany({
      data: { availableAt: new Date(Date.now() - 1000) },
    });

  it('delivers in the order messages were queued and keeps no body afterwards', async () => {
    for (const to of ['a@example.test', 'b@example.test', 'c@example.test']) {
      await app.get(OutboxService).enqueueEmail(message(to));
    }
    expect(await worker.drain()).toBe(3);
    expect(mail.sent.map((m) => m.to)).toEqual([
      'a@example.test',
      'b@example.test',
      'c@example.test',
    ]);
    const rows = await prisma.outboxMessage.findMany();
    expect(
      rows.every(
        (r) => r.status === 'DONE' && r.attempts === 1 && r.processedAt,
      ),
    ).toBe(true);
    expect(JSON.stringify(rows.map((r) => r.payload))).not.toContain('secret');
  });

  it('retries a failed delivery later, then succeeds', async () => {
    await app.get(OutboxService).enqueueEmail(message('retry@example.test'));
    const deliver = vi
      .spyOn(mail, 'deliver')
      .mockRejectedValueOnce(new Error('SMTP down'));

    await worker.drain();
    let row = await prisma.outboxMessage.findFirstOrThrow();
    expect(row).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastError: 'SMTP down',
    });
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(row.payload)).toContain('#token=abc');

    // Not due yet: nothing happens.
    expect(await worker.drain()).toBe(0);
    await makeDue();
    await worker.drain();
    row = await prisma.outboxMessage.findFirstOrThrow();
    expect(row).toMatchObject({ status: 'DONE', attempts: 2, lastError: null });
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it(`gives up after ${MAX_ATTEMPTS} attempts and removes the body`, async () => {
    await app.get(OutboxService).enqueueEmail(message('dead@example.test'));
    vi.spyOn(mail, 'deliver').mockRejectedValue(
      new Error('mailbox unavailable'),
    );
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) {
      await makeDue();
      await worker.drain();
    }
    const row = await prisma.outboxMessage.findFirstOrThrow();
    expect(row).toMatchObject({
      status: 'FAILED',
      attempts: MAX_ATTEMPTS,
      lastError: 'mailbox unavailable',
    });
    expect(row.payload).toEqual({ to: 'dead@example.test', subject: 'Hello' });
  });

  it('picks up a message whose worker crashed mid-delivery', async () => {
    await app.get(OutboxService).enqueueEmail(message('crash@example.test'));
    await prisma.outboxMessage.updateMany({
      data: {
        status: 'PROCESSING',
        attempts: 1,
        lockedUntil: new Date(Date.now() - 1000),
      },
    });
    await worker.drain();
    expect(mail.sent.map((m) => m.to)).toEqual(['crash@example.test']);
  });

  it('two workers draining at once send each message once', async () => {
    for (let i = 0; i < 30; i += 1)
      await app.get(OutboxService).enqueueEmail(message(`m${i}@example.test`));
    const other = await createTestApp();
    try {
      const otherMail = other.get(MailService);
      await Promise.all([worker.drain(), other.get(OutboxWorker).drain()]);
      const all = [...mail.sent, ...otherMail.sent].map((m) => m.to);
      expect(all).toHaveLength(30);
      expect(new Set(all).size).toBe(30);
    } finally {
      await other.close();
    }
  });

  it('a change that rolls back queues nothing', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await app
          .get(OutboxService)
          .enqueueEmail(message('never@example.test'), { db: tx });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.outboxMessage.count()).toBe(0);
  });
});
