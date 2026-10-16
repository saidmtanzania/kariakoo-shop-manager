import type { INestApplication } from '@nestjs/common';
import { newId } from '../../../backend/src/common/ids/ids.js';
import { PrismaService } from '../../../backend/src/database/prisma.service.js';
import { signedInUser } from './auth.js';

const DAY = 86_400_000;
let planCounter = 0;

/** A signed-in platform operator (the flag is set the way the CLI sets it). */
export async function platformAdmin(app: INestApplication, label = 'platform') {
  const user = await signedInUser(app, label);
  await app.get(PrismaService).user.update({
    where: { id: user.userId },
    data: { isPlatformAdmin: true },
  });
  return user;
}

/** Inserts a plan directly. Prices here are test values, not real ones. */
export async function insertPlan(
  app: INestApplication,
  options: {
    interval?: 'WEEK' | 'MONTH';
    price?: string;
    seats?: number | null;
    graceDays?: number;
    active?: boolean;
    features?: {
      featureKey: string;
      enabled: boolean;
      limitValue: number | null;
    }[];
  } = {},
) {
  planCounter += 1;
  const id = newId();
  const prisma = app.get(PrismaService);
  await prisma.plan.create({
    data: {
      id,
      code: `test-${Date.now()}-${planCounter}`,
      name: `Test plan ${planCounter}`,
      interval: options.interval ?? 'MONTH',
      price: options.price ?? '1000.00',
      graceDays: options.graceDays ?? 3,
      active: options.active ?? true,
      features: {
        create: options.features ?? [
          {
            featureKey: 'seats',
            enabled: true,
            limitValue: options.seats === undefined ? 5 : options.seats,
          },
        ],
      },
    },
  });
  return id;
}

/** Puts a shop's subscription into a state by moving its dates. */
export async function setSubscription(
  app: INestApplication,
  shopId: string,
  state: {
    trialEndsAt?: Date;
    paidUntil?: Date | null;
    planId?: string | null;
    graceDays?: number;
  },
) {
  await app.get(PrismaService).subscription.update({
    where: { shopId },
    data: state,
  });
}

/** A shop whose trial is over and which has paid for `planId` until `days` from now. */
export function makePaid(
  app: INestApplication,
  shopId: string,
  planId: string,
  days = 20,
) {
  return setSubscription(app, shopId, {
    trialEndsAt: new Date(Date.now() - 30 * DAY),
    paidUntil: new Date(Date.now() + days * DAY),
    planId,
  });
}

/** A shop whose unpaid trial has ended (read-only). */
export function makeRestricted(app: INestApplication, shopId: string) {
  return setSubscription(app, shopId, {
    trialEndsAt: new Date(Date.now() - DAY),
    paidUntil: null,
    planId: null,
  });
}

export function key(): string {
  return `idem-${newId()}`;
}

export { DAY };
