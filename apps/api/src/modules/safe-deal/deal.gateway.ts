import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/** Куда выплатить по сделке: токен карты из виджета ЮKassa или кошелёк ЮMoney. */
export type DealDestination = { method: 'card'; token: string } | { method: 'yoomoney'; account: string };

export interface DealPayoutResult {
  externalId: string;
  status: 'paid' | 'pending' | 'failed';
  reason?: string;
  /** Сумма у шлюза — для сверки (часть 129); у заглушки её нет. */
  amount?: bigint;
}

/**
 * Операции «Безопасной сделки» ЮKassa (часть 123): открыть сделку, вернуть
 * деньги покупателю с неё, выплатить продавцу по ней. Платёж в сделку —
 * обычный платёж с объектом `deal` (payments/yookassa.provider.ts).
 */
export interface DealGateway {
  readonly key: string;
  createDeal(input: { orderId: string; description: string }): Promise<string>;
  /** Полный возврат покупателю: платёж целиком обратно на карту, сделка закрывается. */
  refund(input: { paymentId: string; amount: bigint; currency: string; idempotenceKey: string }): Promise<string>;
  payout(input: { dealId: string; amount: bigint; currency: string; destination: DealDestination; description: string; idempotenceKey: string }): Promise<DealPayoutResult>;
  payoutStatus(externalId: string): Promise<DealPayoutResult>;
}

const toValue = (minor: bigint) => `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;

/**
 * Заглушка: сделка, возврат и выплата проходят сразу. Кошелёк ЮMoney,
 * начинающийся с 4100000000, — отказ: так e2e проверяет повтор выплаты.
 */
@Injectable()
export class MockDealGateway implements DealGateway {
  readonly key = 'mock';
  async createDeal(): Promise<string> {
    return `dl-mock-${randomUUID()}`;
  }
  async refund(): Promise<string> {
    return `rf-mock-${randomUUID()}`;
  }
  async payout(input: { destination: DealDestination }): Promise<DealPayoutResult> {
    const id = `po-mock-${randomUUID()}`;
    if (input.destination.method === 'yoomoney' && input.destination.account.startsWith('4100000000')) {
      return { externalId: id, status: 'failed', reason: 'identification_required' };
    }
    return { externalId: id, status: 'paid' };
  }
  async payoutStatus(externalId: string): Promise<DealPayoutResult> {
    return { externalId, status: 'paid' };
  }
}

/**
 * ЮKassa по документации «Безопасной сделки»: POST /v3/deals (type
 * safe_deal, fee_moment deal_closed — вознаграждение площадке при закрытии
 * сделки: только так покупателю можно вернуть платёж целиком, при
 * payment_succeeded — лишь долю продавца), POST /v3/refunds (полный
 * возврат — payment_id и amount, без объекта deal), POST /v3/payouts с
 * `deal.id`. Ключи — магазина «Безопасной сделки»
 * (YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY). Не проверено на живом магазине:
 * договора нет (часть 107).
 */
@Injectable()
export class YooKassaDealGateway implements DealGateway {
  readonly key = 'yookassa';
  private readonly logger = new Logger(YooKassaDealGateway.name);

  private get api(): string {
    const test = process.env.NODE_ENV !== 'production' ? process.env.YOOKASSA_API_URL : undefined;
    return (test ?? 'https://api.yookassa.ru/v3').replace(/\/$/, '');
  }

  private headers(key: string): Record<string, string> {
    const auth = Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString('base64');
    return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', 'Idempotence-Key': key };
  }

  private async call(path: string, body: unknown, key: string): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${this.api}${path}`, {
        method: 'POST',
        headers: this.headers(key),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      this.logger.error(`ЮKassa недоступна: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      this.logger.error(`ЮKassa ${path} (${res.status}): ${JSON.stringify(json).slice(0, 400)}`);
      throw new ServiceUnavailableException('Платёжный шлюз отказал. Попробуйте позже.');
    }
    return json;
  }

  static dealBody(input: { orderId: string; description: string }) {
    return {
      type: 'safe_deal',
      fee_moment: 'deal_closed',
      metadata: { orderId: input.orderId },
      description: input.description.slice(0, 128),
    };
  }

  static refundBody(input: { paymentId: string; amount: bigint; currency: string }) {
    return { payment_id: input.paymentId, amount: { value: toValue(input.amount), currency: input.currency } };
  }

  static payoutBody(input: { dealId: string; amount: bigint; currency: string; destination: DealDestination; description: string }) {
    return {
      amount: { value: toValue(input.amount), currency: input.currency },
      deal: { id: input.dealId },
      description: input.description.slice(0, 128),
      ...(input.destination.method === 'card'
        ? { payout_token: input.destination.token }
        : { payout_destination_data: { type: 'yoo_money', account_number: input.destination.account } }),
    };
  }

  async createDeal(input: { orderId: string; description: string }): Promise<string> {
    const json = await this.call('/deals', YooKassaDealGateway.dealBody(input), `deal-${input.orderId}`);
    return String(json.id);
  }

  async refund(input: { paymentId: string; amount: bigint; currency: string; idempotenceKey: string }) {
    const json = await this.call('/refunds', YooKassaDealGateway.refundBody(input), input.idempotenceKey);
    return String(json.id);
  }

  private result(json: Record<string, unknown>): DealPayoutResult {
    const status = json.status === 'succeeded' ? 'paid' : json.status === 'canceled' ? 'failed' : 'pending';
    const reason = (json.cancellation_details as { reason?: string } | undefined)?.reason;
    const value = (json.amount as { value?: string } | undefined)?.value;
    const m = typeof value === 'string' ? /^(\d+)(?:\.(\d{1,2}))?$/.exec(value) : null;
    const amount = m ? BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0')) : null;
    return { externalId: String(json.id), status, ...(reason ? { reason } : {}), ...(amount !== null ? { amount } : {}) };
  }

  async payout(input: { dealId: string; amount: bigint; currency: string; destination: DealDestination; description: string; idempotenceKey: string }) {
    return this.result(await this.call('/payouts', YooKassaDealGateway.payoutBody(input), input.idempotenceKey));
  }

  async payoutStatus(externalId: string): Promise<DealPayoutResult> {
    const res = await fetch(`${this.api}/payouts/${encodeURIComponent(externalId)}`, {
      headers: this.headers(`get-${externalId}`),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!res?.ok) return { externalId, status: 'pending' };
    return this.result((await res.json()) as Record<string, unknown>);
  }
}
