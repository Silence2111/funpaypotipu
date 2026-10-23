import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { GATEWAY_METHOD_KEYS } from '@gamemarket/shared';
import type {
  DepositInput,
  DepositSession,
  PaymentProvider,
  WebhookEvent,
} from './payment.provider';

const webhookSchema = z.object({
  providerRef: z.string().min(1),
  status: z.enum(['succeeded', 'failed']),
  signature: z.string().min(1),
});

/** Сырой payload вебхука заглушки: событие и его HMAC-подпись. */
export type MockWebhookPayload = z.infer<typeof webhookSchema>;

/**
 * Тестовый провайдер для разработки без реального шлюза. Демонстрирует
 * production-форму: вебхук подписан HMAC-SHA256. Настоящий шлюз — ЮKassa
 * (yookassa.provider.ts) — реализует тот же интерфейс со своей проверкой.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly key = 'mock';
  readonly methods = GATEWAY_METHOD_KEYS;
  private readonly secret = process.env.MOCK_WEBHOOK_SECRET ?? 'dev-webhook-secret';

  async createDeposit(input: DepositInput): Promise<DepositSession> {
    return {
      providerRef: input.providerRef,
      url: `/api/payments/mock/callback?providerRef=${input.providerRef}`,
      redirect: false,
    };
  }

  /** Подпись события (в проде это делает провайдер; здесь — для dev/тестов). */
  sign(providerRef: string, status: string): string {
    return createHmac('sha256', this.secret).update(`${providerRef}:${status}`).digest('hex');
  }

  async parseWebhook(body: unknown): Promise<WebhookEvent | null> {
    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) return null;
    const payload = parsed.data;
    const expected = Buffer.from(this.sign(payload.providerRef, payload.status));
    const got = Buffer.from(payload.signature);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    return { providerRef: payload.providerRef, status: payload.status };
  }
}
