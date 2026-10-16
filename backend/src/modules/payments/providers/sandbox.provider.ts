import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/env.schema.js';
import type {
  CallbackVerification,
  PaymentProvider,
  ProviderPaymentStatus,
  ProviderUpdate,
} from './payment-provider.js';

export const SANDBOX_SIGNATURE_HEADER = 'x-sandbox-signature';

const STATUSES: readonly ProviderPaymentStatus[] = [
  'PENDING',
  'CONFIRMED',
  'FAILED',
  'REVERSED',
];

/** HMAC-SHA256 of the raw body, hex encoded. */
export function sandboxSignature(
  secret: string,
  body: string | Buffer,
): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * A stand-in provider for development and tests, shaped like a real one:
 * signed callbacks and a status lookup. Enabled only when
 * PAYMENT_SANDBOX_SECRET is set, which production refuses. Statuses for
 * reconciliation are held in memory and set by tests through settle().
 */
@Injectable()
export class SandboxProvider implements PaymentProvider {
  readonly key = 'sandbox';
  private readonly settled = new Map<string, ProviderUpdate>();
  private counter = 0;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.PAYMENT_SANDBOX_SECRET);
  }

  initiate(payment: { paymentId: string }): Promise<{ reference: string }> {
    return Promise.resolve({ reference: `SBX-${payment.paymentId}` });
  }

  verifyCallback(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): CallbackVerification {
    const secret = this.config.PAYMENT_SANDBOX_SECRET;
    if (!secret) return { valid: false, reason: 'provider_disabled' };
    const given = headers[SANDBOX_SIGNATURE_HEADER];
    if (typeof given !== 'string' || !/^[0-9a-f]{64}$/.test(given)) {
      return { valid: false, reason: 'missing_signature' };
    }
    const expected = Buffer.from(sandboxSignature(secret, rawBody), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(given, 'hex'))) {
      return { valid: false, reason: 'bad_signature' };
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { valid: false, reason: 'malformed_body' };
    }
    const b = body as Record<string, unknown>;
    if (
      typeof b.eventId !== 'string' ||
      typeof b.reference !== 'string' ||
      !STATUSES.includes(b.status as ProviderPaymentStatus) ||
      b.eventId.length > 100 ||
      b.reference.length > 100
    ) {
      return { valid: false, reason: 'malformed_body' };
    }
    return {
      valid: true,
      update: {
        eventId: b.eventId,
        reference: b.reference,
        status: b.status as ProviderPaymentStatus,
        amount: typeof b.amount === 'string' ? b.amount : null,
        currency: typeof b.currency === 'string' ? b.currency : null,
      },
    };
  }

  fetchStatus(reference: string): Promise<ProviderUpdate | null> {
    return Promise.resolve(this.settled.get(reference) ?? null);
  }

  /** Test hook: what fetchStatus will report for a reference. */
  settle(
    reference: string,
    status: ProviderPaymentStatus,
    amount: string | null,
    currency = 'TZS',
  ): void {
    this.counter += 1;
    this.settled.set(reference, {
      eventId: `sandbox-poll-${this.counter}`,
      reference,
      status,
      amount,
      currency,
    });
  }
}
