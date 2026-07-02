import { Injectable } from '@nestjs/common';
import type { DepositInput, DepositSession, PaymentProvider } from './payment.provider';

/**
 * Тестовый провайдер для разработки без реального шлюза: «оплата» подтверждается
 * ручным вызовом /payments/mock/callback (имитация вебхука). В проде заменяется
 * реальной реализацией PaymentProvider (docs/04).
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly key = 'mock';

  async createDeposit(input: DepositInput): Promise<DepositSession> {
    return {
      providerRef: input.providerRef,
      url: `/api/payments/mock/callback?providerRef=${input.providerRef}`,
    };
  }
}
