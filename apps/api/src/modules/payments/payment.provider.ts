/** Абстракция платёжного провайдера (docs/04). Позволяет менять шлюз без правок ядра. */
export interface DepositInput {
  amount: bigint;
  currency: string;
  orderId: string;
  providerRef: string;
}

export interface DepositSession {
  providerRef: string;
  /** Ссылка/реквизиты для оплаты. */
  url: string;
}

/** Нормализованное событие вебхука после верификации подписи. */
export interface WebhookEvent {
  providerRef: string;
  status: 'succeeded' | 'failed';
}

/** Сырой payload вебхука (как приходит от провайдера). */
export interface WebhookPayload {
  providerRef: string;
  status: 'succeeded' | 'failed';
  signature: string;
}

export interface PaymentProvider {
  readonly key: string;
  createDeposit(input: DepositInput): Promise<DepositSession>;
  /** Проверка подлинности вебхука (HMAC-подпись). Возвращает событие или null. */
  verifyWebhook(payload: WebhookPayload): WebhookEvent | null;
}
