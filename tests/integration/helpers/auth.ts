import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@ksm/shared';
import { PrismaService } from '../../../backend/src/database/prisma.service.js';
import { MailService } from '../../../backend/src/mail/mail.service.js';
import { OutboxWorker } from '../../../backend/src/outbox/outbox.worker.js';

export const PASSWORD = 'correct horse battery';
export const CSRF = { [CSRF_HEADER]: CSRF_HEADER_VALUE };

/** A cookie-keeping client that sends the CSRF header on every request. */
export type Client = ReturnType<typeof request.agent>;
export function client(app: INestApplication): Client {
  return request.agent(app.getHttpServer()).set(CSRF);
}

/**
 * Empties every application table except the seeded permission catalog and
 * billing settings (reset to defaults). TRUNCATE does not fire the row
 * triggers on audit_logs, subscription_periods and payment_events, which
 * only block UPDATE and DELETE.
 */
export async function resetDatabase(app: INestApplication): Promise<void> {
  await app
    .get(PrismaService)
    .$executeRawUnsafe(
      'TRUNCATE stock_movements, stock_adjustments, stock_balances, price_history, product_units, products, product_categories, stock_locations, audit_logs, outbox_messages, invitation_roles, invitations, membership_roles, role_permissions, roles, sessions, auth_tokens, shop_memberships, subscription_reminders, payment_events, subscription_periods, subscription_payments, subscriptions, plan_features, plans, shops, users, rate_limit_counters CASCADE',
    );
  // Back to the approved defaults (D-005, D-019).
  await app
    .get(PrismaService)
    .$executeRawUnsafe(
      'UPDATE billing_settings SET trial_days = 14, reminder_days_before = 3, payment_instructions = NULL WHERE id = 1',
    );
  app.get(MailService).sent.length = 0;
}

/** Clears rate-limit counters (files that create many users call this between tests). */
export async function resetRateLimits(app: INestApplication): Promise<void> {
  await app
    .get(PrismaService)
    .$executeRawUnsafe('TRUNCATE rate_limit_counters');
}

/** Delivers every queued outbox message now (the worker is off in tests). */
export async function drainOutbox(app: INestApplication): Promise<void> {
  await app.get(OutboxWorker).drain();
}

/** Delivers queued mail, then returns the newest email to an address and its link token. */
export async function lastMailTo(app: INestApplication, to: string) {
  await drainOutbox(app);
  const mail = app
    .get(MailService)
    .sent.filter((m) => m.to === to)
    .at(-1);
  const token = mail?.text.match(/#token=([\w%-]+)/)?.[1];
  return { mail, token: token ? decodeURIComponent(token) : undefined };
}

let counter = 0;
export function uniqueEmail(label = 'user'): string {
  counter += 1;
  return `${label}.${Date.now()}.${counter}@example.test`;
}

/** Registers, verifies and signs in a user; returns their signed-in client. */
export async function signedInUser(
  app: INestApplication,
  label = 'user',
  email = uniqueEmail(label),
) {
  const agent = client(app);
  await agent
    .post('/api/v1/auth/register')
    .send({ fullName: `${label} Tester`, email, password: PASSWORD })
    .expect(202);
  const { token } = await lastMailTo(app, email);
  await agent.post('/api/v1/auth/verify-email').send({ token }).expect(204);
  await agent
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(204);
  const session = await agent.get('/api/v1/auth/session').expect(200);
  return { agent, email, userId: session.body.user.id as string };
}

/** A signed-in owner with one shop, which is their active shop. */
export async function ownerWithShop(
  app: INestApplication,
  label = 'owner',
  shopName = `${label} shop`,
) {
  const user = await signedInUser(app, label);
  const res = await user.agent
    .post('/api/v1/shops')
    .send({ name: shopName })
    .expect(201);
  return { ...user, shopId: res.body.id as string };
}
