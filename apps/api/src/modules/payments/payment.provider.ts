import type { GatewayMethodKey } from '@gamemarket/shared';

/** Абстракция платёжного провайдера (docs/04). Позволяет менять шлюз без правок ядра. */
export interface DepositInput {
  /** Сколько взять с покупателя — уже с надбавкой способа оплаты. */
  amount: bigint;
  currency: string;
  orderId: string;
  providerRef: string;
  /** Способ оплаты (shared/payment.ts): провайдер открывает нужную форму. */
  method: GatewayMethodKey;
  /** Что оплачивается — покупатель видит это на странице шлюза и в чеке. */
  description: string;
  /** Куда шлюз вернёт покупателя после оплаты. */
  returnUrl: string;
  /** Почта покупателя — для чека, если шлюз их отправляет. */
  customerEmail?: string | null;
  /** «Безопасная сделка» (часть 123): сделка ЮKassa и доля продавца в платеже. */
  deal?: { id: string; sellerAmount: bigint };
}

export interface DepositSession {
  providerRef: string;
  /** Страница оплаты шлюза или dev-ссылка заглушки. */
  url: string;
  /** true — покупателя нужно отправить на url; false — оплата подтверждается здесь (заглушка). */
  redirect: boolean;
  /** Номер платежа у шлюза — для сверки и поиска в его кабинете. */
  externalId?: string;
}

/** Карта оплаты от шлюза: первые 6 и последние 4 цифры, тип и срок — без номера. */
export interface CardPrint {
  first6: string;
  last4: string;
  type?: string;
  /** «12/2030». */
  expiry?: string;
}

/**
 * Событие вебхука, проверенное провайдером. Сумму и валюту провайдер берёт
 * у шлюза, а не из тела запроса, — сервис сверяет их с платежом в базе.
 */
export interface WebhookEvent {
  providerRef: string;
  status: 'succeeded' | 'failed';
  amount?: bigint;
  currency?: string;
  /** Чем заплатили, если картой: по ней «Не могу войти» сверяет проверочный платёж. */
  card?: CardPrint;
}

export interface PaymentProvider {
  readonly key: string;
  /** Способы оплаты, которые принимает шлюз; остальные витрина не показывает. */
  readonly methods: readonly GatewayMethodKey[];
  createDeposit(input: DepositInput): Promise<DepositSession>;
  /**
   * Разбор и проверка вебхука. Событие — платёж подтверждён шлюзом;
   * 'ignore' — событие не про оплату или платёж ещё в процессе (ответить
   * 200, чтобы шлюз не повторял); null — подделка.
   */
  parseWebhook(body: unknown): Promise<WebhookEvent | 'ignore' | null>;
  /**
   * Возврат платежа исходным способом (часть 137): карта, СБП. Ошибка —
   * исключение: деньги у покупателя не списываются повторно, заказ остаётся
   * оплаченным.
   */
  refund?(input: RefundInput): Promise<{ id: string }>;
}

export interface RefundInput {
  /** Номер платежа у шлюза (у ЮKassa — id платежа). */
  externalId: string | null;
  providerRef: string;
  amount: bigint;
  currency: string;
  idempotenceKey: string;
  description: string;
}
