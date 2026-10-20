import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { fromValue, toValue } from '../payments/yookassa.provider';

/** Куда выплачивать. СБП — телефон и банк из списка ЮKassa, ЮMoney — номер кошелька. */
export type PayoutDestination =
  { method: 'sbp'; phone: string; bankId: string } | { method: 'yoomoney'; account: string };

/** Способы, которые выплачивает ЮKassa. Карта — только через её виджет, USDT — нет: эти вручную. */
export const AUTO_METHODS = ['sbp', 'yoomoney'] as const;

export interface GatewayPayout {
  id: string;
  status: 'pending' | 'succeeded' | 'canceled';
  amount: bigint;
  currency: string;
  payoutId: string | null;
  /** Почему отменена: код ЮKassa (insufficient_funds, fraud_suspected, …). */
  reason: string | null;
}

const payoutSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'succeeded', 'canceled']),
  amount: z.object({ value: z.string(), currency: z.string() }),
  metadata: z.record(z.string()).optional(),
  cancellation_details: z
    .object({ party: z.string().optional(), reason: z.string().optional() })
    .optional(),
});

const banksSchema = z.object({
  items: z.array(z.object({ bank_id: z.string(), name: z.string() })),
});

/**
 * Выплаты ЮKassa — отдельный шлюз со своими ключами (агент выплат), не
 * ключи магазина. Включается PAYOUT_PROVIDER=yookassa с
 * YOOKASSA_PAYOUT_AGENT_ID и YOOKASSA_PAYOUT_SECRET_KEY; без них выплаты
 * идут вручную, как раньше. Ключ идемпотентности — id заявки: повтор
 * одобрения не отправит деньги дважды.
 */
@Injectable()
export class YooKassaPayouts {
  private readonly logger = new Logger(YooKassaPayouts.name);
  private banksCache: { at: number; items: Array<{ id: string; name: string }> } | null = null;

  get enabled(): boolean {
    return (
      process.env.PAYOUT_PROVIDER === 'yookassa' &&
      !!process.env.YOOKASSA_PAYOUT_AGENT_ID &&
      !!process.env.YOOKASSA_PAYOUT_SECRET_KEY
    );
  }

  /** Выплачивает ли шлюз этим способом; иначе — вручную. */
  handles(method: string): boolean {
    return this.enabled && (AUTO_METHODS as readonly string[]).includes(method);
  }

  private get api(): string {
    const test = process.env.NODE_ENV !== 'production' ? process.env.YOOKASSA_API_URL : undefined;
    return (test ?? 'https://api.yookassa.ru/v3').replace(/\/$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const auth = Buffer.from(
      `${process.env.YOOKASSA_PAYOUT_AGENT_ID}:${process.env.YOOKASSA_PAYOUT_SECRET_KEY}`,
    ).toString('base64');
    return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...extra };
  }

  private async call(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; json: unknown }> {
    try {
      const res = await fetch(`${this.api}${path}`, {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    } catch (e) {
      this.logger.error(`ЮKassa (выплаты) недоступна: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    }
  }

  private parse(json: unknown): GatewayPayout | null {
    const p = payoutSchema.safeParse(json);
    const amount = p.success ? fromValue(p.data.amount.value) : null;
    if (!p.success || amount === null) return null;
    return {
      id: p.data.id,
      status: p.data.status,
      amount,
      currency: p.data.amount.currency,
      payoutId: p.data.metadata?.payoutId ?? null,
      reason: p.data.cancellation_details?.reason ?? null,
    };
  }

  /** Отправить выплату: сумма «на руки», уже без комиссии площадки. */
  async create(input: {
    payoutId: string;
    amount: bigint;
    currency: string;
    destination: PayoutDestination;
  }): Promise<GatewayPayout> {
    const d = input.destination;
    const destination =
      d.method === 'sbp'
        ? { type: 'sbp', phone: d.phone, bank_id: d.bankId }
        : { type: 'yoo_money', account_number: d.account };
    const { status, json } = await this.call('/payouts', {
      method: 'POST',
      headers: this.headers({ 'Idempotence-Key': input.payoutId }),
      body: JSON.stringify({
        amount: { value: toValue(input.amount), currency: input.currency },
        payout_destination_data: destination,
        description: `Выплата продавцу GameMarket`,
        metadata: { payoutId: input.payoutId },
      }),
    });
    const payout = status >= 200 && status < 300 ? this.parse(json) : null;
    if (!payout) {
      this.logger.error(
        `ЮKassa отказала в выплате (${status}): ${JSON.stringify(json).slice(0, 500)}`,
      );
      throw new ServiceUnavailableException(
        'Платёжный шлюз не принял выплату. Попробуйте ещё раз.',
      );
    }
    return payout;
  }

  /** Статус выплаты у ЮKassa; null — такой выплаты нет. */
  async fetch(externalId: string): Promise<GatewayPayout | null> {
    if (!/^[\w-]{1,64}$/.test(externalId)) return null;
    const { status, json } = await this.call(`/payouts/${encodeURIComponent(externalId)}`, {
      headers: this.headers(),
    });
    if (status === 404) return null;
    const payout = status >= 200 && status < 300 ? this.parse(json) : null;
    if (!payout)
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    return payout;
  }

  /** Банки СБП для выплаты — список ЮKassa, на час в памяти. */
  async sbpBanks(): Promise<Array<{ id: string; name: string }>> {
    if (!this.enabled) return [];
    if (this.banksCache && Date.now() - this.banksCache.at < 3600_000) return this.banksCache.items;
    const { status, json } = await this.call('/sbp_banks', { headers: this.headers() });
    const banks = status === 200 ? banksSchema.safeParse(json) : null;
    if (!banks?.success)
      throw new ServiceUnavailableException('Платёжный шлюз не ответил. Попробуйте ещё раз.');
    const items = banks.data.items.map((b) => ({ id: b.bank_id, name: b.name }));
    this.banksCache = { at: Date.now(), items };
    return items;
  }
}
