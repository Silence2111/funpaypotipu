import { Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentProvider } from './payment.provider';
import { MockPaymentProvider } from './mock.provider';

/**
 * Реестр платёжных провайдеров. Добавление реального провайдера = новый класс,
 * зарегистрированный здесь; ядро (orders/ledger) не меняется.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(mock: MockPaymentProvider) {
    this.register(mock);
    // сюда добавляются реальные провайдеры: this.register(new SbpProvider(...)), и т.д.
  }

  register(provider: PaymentProvider) {
    this.providers.set(provider.key, provider);
  }

  get(key: string): PaymentProvider {
    const p = this.providers.get(key);
    if (!p) throw new NotFoundException(`Платёжный провайдер "${key}" не найден`);
    return p;
  }

  get defaultKey(): string {
    return process.env.PAYMENT_PROVIDER ?? 'mock';
  }
}
