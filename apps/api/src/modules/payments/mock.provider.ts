import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  DepositInput,
  DepositSession,
  PaymentProvider,
  WebhookEvent,
  WebhookPayload,
} from './payment.provider';

/**
 * Тестовый провайдер для разработки без реального шлюза. Демонстрирует
 * production-форму: вебхук подписан HMAC-SHA256. Реальный провайдер (СБП/крипта)
 * реализует тот же интерфейс со своей схемой подписи (docs/04).
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly key = 'mock';
  private readonly secret = process.env.MOCK_WEBHOOK_SECRET ?? 'dev-webhook-secret';

  async createDeposit(input: DepositInput): Promise<DepositSession> {
    return {
      providerRef: input.providerRef,
      url: `/api/payments/mock/callback?providerRef=${input.providerRef}`,
    };
  }

  /** Подпись события (в проде это делает провайдер; здесь — для dev/тестов). */
  sign(providerRef: string, status: string): string {
    return createHmac('sha256', this.secret).update(`${providerRef}:${status}`).digest('hex');
  }

  verifyWebhook(payload: WebhookPayload): WebhookEvent | null {
    const expected = this.sign(payload.providerRef, payload.status);
    const a = Buffer.from(expected);
    const b = Buffer.from(payload.signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { providerRef: payload.providerRef, status: payload.status };
  }
}
