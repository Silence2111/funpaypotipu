import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import type { GatewayMethodKey } from '@gamemarket/shared';
import type {
  CardPrint,
  DepositInput,
  DepositSession,
  PaymentProvider,
  WebhookEvent,
} from './payment.provider';

/** Способы, которые ЮKassa принимает: СБП и карта (Apple Pay и Google Pay — картой). */
export const YOOKASSA_METHODS: readonly GatewayMethodKey[] = [
  'sbp',
  'card',
  'applepay',
  'googlepay',
];

const METHOD_TYPE: Partial<Record<GatewayMethodKey, string>> = {
  sbp: 'sbp',
  card: 'bank_card',
  applepay: 'bank_card',
  googlepay: 'bank_card',
};

/** «156600» копеек → «1566.00»: ЮKassa принимает сумму строкой в рублях. */
export const toValue = (minor: bigint) =>
  `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;

/** «1566.00» → 156600n; null — не сумма. */
export function fromValue(value: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  return m ? BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0')) : null;
}

// Уведомление ЮKassa: событие и объект платежа. Верим только id — остальное
// перечитываем у ЮKassa: уведомления не подписаны, а адрес вебхука публичный.
const notificationSchema = z.object({
  event: z.string(),
  object: z.object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\w-]+$/),
  }),
});

const paymentSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'waiting_for_capture', 'succeeded', 'canceled']),
  paid: z.boolean().optional(),
  amount: z.object({ value: z.string(), currency: z.string() }),
  metadata: z.record(z.string()).optional(),
  confirmation: z.object({ confirmation_url: z.string().url().optional() }).optional(),
  payment_method: z
    .object({
      type: z.string(),
      card: z
        .object({
          first6: z.string().regex(/^\d{6}$/),
          last4: z.string().regex(/^\d{4}$/),
          card_type: z.string().optional(),
          expiry_month: z.string().optional(),
          expiry_year: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});
type YooPayment = z.infer<typeof paymentSchema>;

/** Проверочный платёж «Не могу войти»: его вебхуки — не оплата заказа. */
export const CARD_CHECK_PURPOSE = 'recovery_card';

/** Карта платежа без номера: первые 6 и последние 4 цифры, тип и срок. */
const printOf = (p: YooPayment): CardPrint | undefined => {
  const c = p.payment_method?.card;
  if (!c) return undefined;
  return {
    first6: c.first6,
    last4: c.last4,
    ...(c.card_type ? { type: c.card_type } : {}),
    ...(c.expiry_month && c.expiry_year ? { expiry: `${c.expiry_month}/${c.expiry_year}` } : {}),
  };
};

/**
 * ЮKassa — приём оплаты картой и через СБП. Платёж создаётся с переходом на
 * страницу ЮKassa и списанием сразу (capture), покупатель возвращается на
 * заказ. Оплату подтверждает только вебхук, а вебхук проверяется запросом
 * статуса и суммы платежа в API ЮKassa с ключом магазина: подделать «оплачено»
 * POST-запросом на публичный адрес нельзя.
 *
 * Без YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY провайдер выключен. Чеки по
 * 54-ФЗ — YOOKASSA_RECEIPTS=on, ставка НДС и предмет расчёта — из окружения:
 * их выбирает бухгалтер магазина, а не код.
 */
@Injectable()
export class YooKassaProvider implements PaymentProvider {
  readonly key = 'yookassa';
  readonly methods = YOOKASSA_METHODS;
  private readonly logger = new Logger(YooKassaProvider.name);

  get enabled(): boolean {
    return !!process.env.YOOKASSA_SHOP_ID && !!process.env.YOOKASSA_SECRET_KEY;
  }

  /** Боевой адрес API; подмена — только вне боя, для тестового сервера. */
  private get api(): string {
    const test = process.env.NODE_ENV !== 'production' ? process.env.YOOKASSA_API_URL : undefined;
    return (test ?? 'https://api.yookassa.ru/v3').replace(/\/$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const auth = Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`,
    ).toString('base64');
    return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...extra };
  }

  get receipts(): boolean {
    return process.env.YOOKASSA_RECEIPTS === 'on';
  }

  async createDeposit(input: DepositInput): Promise<DepositSession> {
    // Чек уходит покупателю на почту; без неё ЮKassa платёж с чеком не примет.
    if (this.receipts && !input.customerEmail) {
      throw new BadRequestException(
        'Для чека об оплате нужна почта: добавьте её в настройках профиля.',
      );
    }
    const type = METHOD_TYPE[input.method];
    const body = {
      amount: { value: toValue(input.amount), currency: input.currency },
      capture: true,
      confirmation: { type: 'redirect', return_url: input.returnUrl },
      description: input.description.slice(0, 128),
      metadata: {
        providerRef: input.providerRef,
        ...(input.orderId ? { orderId: input.orderId } : {}),
      },
      ...(type ? { payment_method_data: { type } } : {}),
      ...(this.receipts && input.customerEmail
        ? {
            receipt: {
              customer: { email: input.customerEmail },
              items: [
                {
                  description: input.description.slice(0, 128),
                  quantity: '1.00',
                  amount: { value: toValue(input.amount), currency: input.currency },
                  vat_code: Number(process.env.YOOKASSA_VAT_CODE ?? 1),
                  payment_subject: process.env.YOOKASSA_PAYMENT_SUBJECT ?? 'service',
                  payment_mode: 'full_payment',
                },
              ],
            },
          }
        : {}),
    };
    let res: Response;
    try {
      // Ключ идемпотентности — наш providerRef: повтор запроса не создаст второй платёж.
      res = await fetch(`${this.api}/payments`, {
        method: 'POST',
        headers: this.headers({ 'Idempotence-Key': input.providerRef }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      this.logger.error(`ЮKassa недоступна: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    }
    const json = (await res.json().catch(() => null)) as unknown;
    const payment = paymentSchema.safeParse(json);
    const url = payment.success ? payment.data.confirmation?.confirmation_url : undefined;
    if (!res.ok || !payment.success || !url) {
      this.logger.error(
        `ЮKassa отказала в платеже (${res.status}): ${JSON.stringify(json).slice(0, 500)}`,
      );
      throw new ServiceUnavailableException(
        'Платёжный шлюз не принял платёж. Попробуйте ещё раз или выберите другой способ.',
      );
    }
    return { providerRef: input.providerRef, url, redirect: true, externalId: payment.data.id };
  }

  async parseWebhook(body: unknown): Promise<WebhookEvent | 'ignore' | null> {
    const note = notificationSchema.safeParse(body);
    if (!note.success) return null;
    if (note.data.event !== 'payment.succeeded' && note.data.event !== 'payment.canceled')
      return 'ignore';

    let res: Response;
    try {
      res = await fetch(`${this.api}/payments/${encodeURIComponent(note.data.object.id)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      // Ответ не 2xx — ЮKassa повторит уведомление позже.
      this.logger.error(`ЮKassa недоступна при проверке уведомления: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    }
    if (res.status === 404) return null;
    const payment = paymentSchema.safeParse(await res.json().catch(() => null));
    if (!res.ok || !payment.success) {
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    }
    const p = payment.data;
    // Проверка карты «Не могу войти»: блокировку отменяем сами, заказа за ней нет.
    if (p.metadata?.purpose === CARD_CHECK_PURPOSE) return 'ignore';
    const providerRef = p.metadata?.providerRef;
    const amount = fromValue(p.amount.value);
    if (!providerRef || amount === null) return null;
    if (p.status === 'succeeded' && p.paid !== false) {
      const card = printOf(p);
      return {
        providerRef,
        status: 'succeeded',
        amount,
        currency: p.amount.currency,
        ...(card ? { card } : {}),
      };
    }
    if (p.status === 'canceled')
      return { providerRef, status: 'failed', amount, currency: p.amount.currency };
    return 'ignore';
  }

  /** Платёж по id: статус, карта и страница оплаты; null — у ЮKassa такого нет. */
  async payment(id: string) {
    let res: Response;
    try {
      res = await fetch(`${this.api}/payments/${encodeURIComponent(id)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      this.logger.error(`ЮKassa недоступна: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    }
    if (res.status === 404) return null;
    const payment = paymentSchema.safeParse(await res.json().catch(() => null));
    if (!res.ok || !payment.success) {
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    }
    const p = payment.data;
    return {
      id: p.id,
      status: p.status,
      card: printOf(p),
      url: p.confirmation?.confirmation_url,
      metadata: p.metadata ?? {},
    };
  }

  /**
   * Проверка карты: платёж в два этапа (capture: false) — сумма только
   * блокируется на карте, по ней видно, какой картой платили, а потом
   * блокировка отменяется. Деньги не списываются. Нужен двухстадийный приём
   * платежей в настройках магазина ЮKassa.
   */
  async createHold(input: {
    amount: bigint;
    description: string;
    returnUrl: string;
    idempotenceKey: string;
    metadata: Record<string, string>;
  }) {
    let res: Response;
    try {
      res = await fetch(`${this.api}/payments`, {
        method: 'POST',
        headers: this.headers({ 'Idempotence-Key': input.idempotenceKey }),
        body: JSON.stringify({
          amount: { value: toValue(input.amount), currency: 'RUB' },
          capture: false,
          confirmation: { type: 'redirect', return_url: input.returnUrl },
          description: input.description.slice(0, 128),
          metadata: input.metadata,
          payment_method_data: { type: 'bank_card' },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      this.logger.error(`ЮKassa недоступна: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    }
    const json = (await res.json().catch(() => null)) as unknown;
    const payment = paymentSchema.safeParse(json);
    const url = payment.success ? payment.data.confirmation?.confirmation_url : undefined;
    if (!res.ok || !payment.success || !url) {
      this.logger.error(
        `ЮKassa отказала в проверке карты (${res.status}): ${JSON.stringify(json).slice(0, 500)}`,
      );
      throw new ServiceUnavailableException('Платёжный шлюз не принял платёж. Попробуйте ещё раз.');
    }
    return { id: payment.data.id, url };
  }

  /** Отменить платёж в ожидании подтверждения — блокировка на карте снимается. */
  async cancel(id: string) {
    const res = await fetch(`${this.api}/payments/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: this.headers({ 'Idempotence-Key': `cancel-${id}` }),
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ЮKassa не отменила платёж ${id}: ${res.status}`);
  }
}
