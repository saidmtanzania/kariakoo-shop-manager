/**
 * The boundary between subscription billing and a payment provider
 * (decision D-006). Business rules live in PaymentsService; an adapter only
 * talks to its provider and verifies what the provider sends. Adding the
 * chosen Tanzanian provider means adding one adapter, not changing billing.
 *
 * No adapter for a real provider exists yet, and nothing here performs
 * automatic recurring mobile-money deductions.
 */
export type ProviderPaymentStatus =
  'PENDING' | 'CONFIRMED' | 'FAILED' | 'REVERSED';

/** A payment status reported by a provider, after verification. */
export interface ProviderUpdate {
  /** The provider's id for this notification, used to drop duplicates. */
  eventId: string;
  /** The provider's reference for the payment. */
  reference: string;
  status: ProviderPaymentStatus;
  /** Decimal string as the provider reported it, when it did. */
  amount: string | null;
  currency: string | null;
}

export type CallbackVerification =
  { valid: false; reason: string } | { valid: true; update: ProviderUpdate };

export interface PaymentProvider {
  readonly key: string;
  /**
   * Starts a payment with the provider (for example an STK push) and
   * returns its reference. Always called outside database transactions.
   */
  initiate?(payment: {
    paymentId: string;
    amount: string;
    currency: string;
    payerPhone: string | null;
  }): Promise<{ reference: string }>;
  /**
   * Checks a callback's signature over the exact bytes received. Only a
   * valid callback can change a payment.
   */
  verifyCallback?(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): CallbackVerification;
  /** Asks the provider for a payment's status (reconciliation). */
  fetchStatus?(reference: string): Promise<ProviderUpdate | null>;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
