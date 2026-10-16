import { Injectable } from '@nestjs/common';
import type { PaymentProvider } from './payment-provider.js';

/**
 * Manual mobile-money payments (decision D-006, approved 2026-10-16): the
 * shop pays the platform's number and enters the transaction reference;
 * platform staff check it and confirm or reject it. There are no callbacks,
 * so nothing but a platform operator can confirm these payments.
 */
@Injectable()
export class ManualProvider implements PaymentProvider {
  readonly key = 'manual';
}
