/** Абстракция платёжного провайдера (docs/04). Позволяет менять шлюз без правок ядра. */
export interface DepositInput {
  amount: bigint;
  currency: string;
  orderId: string;
  providerRef: string;
}

export interface DepositSession {
  providerRef: string;
  /** Ссылка/реквизиты для оплаты (у mock — локальный callback-эндпоинт). */
  url: string;
}

export interface PaymentProvider {
  readonly key: string;
  createDeposit(input: DepositInput): Promise<DepositSession>;
}
