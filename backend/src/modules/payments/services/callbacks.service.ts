import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { newId } from '../../../common/ids/ids.js';
import { Prisma, PrismaService } from '../../../database/index.js';
import type { ProviderUpdate } from '../providers/payment-provider.js';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { PaymentsService, type UpdateOutcome } from './payments.service.js';

const MAX_STORED_PAYLOAD = 8_000;

function storedPayload(rawBody: Buffer): Prisma.InputJsonValue {
  const text = rawBody.toString('utf8');
  if (text.length <= MAX_STORED_PAYLOAD) {
    try {
      return JSON.parse(text) as Prisma.InputJsonValue;
    } catch {
      // Not JSON: keep the text.
    }
  }
  return {
    raw: text.slice(0, MAX_STORED_PAYLOAD),
    truncated: text.length > MAX_STORED_PAYLOAD,
  };
}

/**
 * Receives provider callbacks. Every callback is stored as evidence, valid
 * or not, keyed by the provider's event id so a repeat is recognised. Only
 * a callback whose signature verifies over the exact bytes received can
 * change a payment, and the change itself goes through PaymentsService.
 */
@Injectable()
export class CallbacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly payments: PaymentsService,
  ) {}

  async receive(
    providerKey: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | undefined,
  ): Promise<{ received: true; outcome: UpdateOutcome }> {
    const provider = this.providers.get(providerKey);
    if (!provider?.verifyCallback) {
      throw new NotFoundException({
        message: 'Unknown payment provider.',
        code: 'provider_not_found',
      });
    }
    const body = rawBody ?? Buffer.alloc(0);
    const verification = provider.verifyCallback(headers, body);

    if (!verification.valid) {
      // Kept for investigation; it changes nothing.
      await this.store(
        providerKey,
        `unverified:${createHash('sha256').update(body).digest('hex')}`,
        body,
        false,
        `invalid:${verification.reason}`,
      );
      throw new UnauthorizedException({
        message: 'The callback signature could not be verified.',
        code: 'invalid_signature',
      });
    }

    const result = await this.processVerified(
      providerKey,
      verification.update,
      body,
    );
    return { received: true, outcome: result };
  }

  /**
   * Stores a verified event (or finds the stored one) and applies it once.
   * An event stored earlier but never processed (a crash mid-way) is
   * processed again on the provider's retry.
   */
  async processVerified(
    providerKey: string,
    update: ProviderUpdate,
    body: Buffer,
  ): Promise<UpdateOutcome> {
    const event = await this.store(
      providerKey,
      update.eventId,
      body,
      true,
      'received',
    );
    if (event.processedAt) return 'duplicate';
    const { outcome, paymentId } = await this.payments.applyProviderUpdate(
      providerKey,
      update,
      'callback',
    );
    await this.prisma.paymentEvent.update({
      where: { id: event.id },
      data: { outcome, paymentId, processedAt: new Date() },
    });
    return outcome;
  }

  private async store(
    provider: string,
    providerEventId: string,
    body: Buffer,
    signatureValid: boolean,
    outcome: string,
  ) {
    await this.prisma.paymentEvent.createMany({
      data: [
        {
          id: newId(),
          provider,
          providerEventId: providerEventId.slice(0, 120),
          payload: storedPayload(body),
          signatureValid,
          outcome,
        },
      ],
      skipDuplicates: true,
    });
    return this.prisma.paymentEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider,
          providerEventId: providerEventId.slice(0, 120),
        },
      },
    });
  }
}
