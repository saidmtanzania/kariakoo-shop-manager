import { Injectable } from '@nestjs/common';
import { ManualProvider } from './manual.provider.js';
import type { PaymentProvider } from './payment-provider.js';
import { SandboxProvider } from './sandbox.provider.js';

/** The payment providers available in this deployment. */
@Injectable()
export class ProviderRegistry {
  private readonly providers: Map<string, PaymentProvider>;

  constructor(manual: ManualProvider, sandbox: SandboxProvider) {
    const list: PaymentProvider[] = [manual];
    if (sandbox.enabled) list.push(sandbox);
    this.providers = new Map(list.map((p) => [p.key, p]));
  }

  get(key: string): PaymentProvider | undefined {
    return this.providers.get(key);
  }

  all(): PaymentProvider[] {
    return [...this.providers.values()];
  }
}
