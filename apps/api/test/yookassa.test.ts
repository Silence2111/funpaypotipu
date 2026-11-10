import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YooKassaProvider, fromValue, toValue } from '../src/modules/payments/yookassa.provider';
import { MockPaymentProvider } from '../src/modules/payments/mock.provider';
import { PaymentProviderRegistry } from '../src/modules/payments/provider.registry';

/**
 * ЮKassa. Проверяется: платёж создаётся с суммой в рублях, способом оплаты,
 * возвратом на заказ и ключом идемпотентности; чек — только с почтой;
 * уведомлению не верим — статус и сумму перечитываем у ЮKassa.
 */

const ENV = { ...process.env };
const INPUT = {
  amount: 104_400n,
  currency: 'RUB',
  orderId: 'o1',
  providerRef: 'ref-1',
  method: 'card' as const,
  description: 'Заказ GM-1 на GameMarket',
  returnUrl: 'https://gm.test/orders/o1?paid=1',
  customerEmail: 'buyer@e.test',
};

type Call = {
  url: string;
  init: { method?: string; headers: Record<string, string>; body?: string };
};
function stubFetch(reply: (call: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: Call['init']) => {
      const call = { url, init };
      calls.push(call);
      const r = reply(call);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
    }),
  );
  return calls;
}

const payment = (over: Record<string, unknown> = {}) => ({
  id: 'yk-1',
  status: 'pending',
  paid: false,
  amount: { value: '1044.00', currency: 'RUB' },
  metadata: { providerRef: 'ref-1', orderId: 'o1' },
  confirmation: {
    type: 'redirect',
    confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=yk-1',
  },
  ...over,
});

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.YOOKASSA_SHOP_ID = '123456';
  process.env.YOOKASSA_SECRET_KEY = 'test_secret';
  delete process.env.YOOKASSA_API_URL;
  delete process.env.YOOKASSA_RECEIPTS;
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe('суммы', () => {
  it('копейки ↔ рубли строкой', () => {
    expect(toValue(104_400n)).toBe('1044.00');
    expect(toValue(5n)).toBe('0.05');
    expect(fromValue('1044.00')).toBe(104_400n);
    expect(fromValue('7.5')).toBe(750n);
    expect(fromValue('1e3')).toBeNull();
  });
});

describe('создание платежа', () => {
  it('сумма, способ, возврат, ключ идемпотентности и ключи магазина', async () => {
    const calls = stubFetch(() => ({ status: 200, json: payment() }));
    const session = await new YooKassaProvider().createDeposit(INPUT);
    expect(session).toEqual({
      providerRef: 'ref-1',
      url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=yk-1',
      redirect: true,
      externalId: 'yk-1',
    });
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.yookassa.ru/v3/payments');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('123456:test_secret').toString('base64')}`,
    );
    expect(init.headers['Idempotence-Key']).toBe('ref-1');
    const body = JSON.parse(init.body!);
    expect(body).toMatchObject({
      amount: { value: '1044.00', currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: 'https://gm.test/orders/o1?paid=1' },
      metadata: { providerRef: 'ref-1', orderId: 'o1' },
      payment_method_data: { type: 'bank_card' },
    });
    expect(body.receipt).toBeUndefined();
  });

  it('СБП — своим способом', async () => {
    const calls = stubFetch(() => ({ status: 200, json: payment() }));
    await new YooKassaProvider().createDeposit({ ...INPUT, method: 'sbp' });
    expect(JSON.parse(calls[0]!.init.body!).payment_method_data).toEqual({ type: 'sbp' });
  });

  it('с чеками — чек на почту покупателя; без почты платёж не создаётся', async () => {
    process.env.YOOKASSA_RECEIPTS = 'on';
    process.env.YOOKASSA_VAT_CODE = '1';
    const calls = stubFetch(() => ({ status: 200, json: payment() }));
    await new YooKassaProvider().createDeposit(INPUT);
    expect(JSON.parse(calls[0]!.init.body!).receipt).toMatchObject({
      customer: { email: 'buyer@e.test' },
      items: [
        {
          quantity: '1.00',
          amount: { value: '1044.00', currency: 'RUB' },
          vat_code: 1,
          payment_mode: 'full_payment',
        },
      ],
    });
    await expect(
      new YooKassaProvider().createDeposit({ ...INPUT, customerEmail: null }),
    ).rejects.toThrow(/нужна почта/);
    expect(calls).toHaveLength(1);
  });

  it('ЮKassa отказала — понятная ошибка, а не сырой ответ', async () => {
    stubFetch(() => ({ status: 400, json: { type: 'error', code: 'invalid_request' } }));
    await expect(new YooKassaProvider().createDeposit(INPUT)).rejects.toThrow(/не принял платёж/);
  });

  it('тестовый адрес API — только вне боя', async () => {
    process.env.YOOKASSA_API_URL = 'http://localhost:4998/v3';
    let calls = stubFetch(() => ({ status: 200, json: payment() }));
    await new YooKassaProvider().createDeposit(INPUT);
    expect(calls[0]!.url).toBe('http://localhost:4998/v3/payments');
    process.env.NODE_ENV = 'production';
    calls = stubFetch(() => ({ status: 200, json: payment() }));
    await new YooKassaProvider().createDeposit(INPUT);
    expect(calls[0]!.url).toBe('https://api.yookassa.ru/v3/payments');
  });
});

describe('уведомления', () => {
  const note = (event: string, id = 'yk-1') => ({
    type: 'notification',
    event,
    object: { id, status: 'succeeded' },
  });

  it('оплачено — только если ЮKassa сама так говорит, с её суммой', async () => {
    const calls = stubFetch(() => ({
      status: 200,
      json: payment({ status: 'succeeded', paid: true }),
    }));
    expect(await new YooKassaProvider().parseWebhook(note('payment.succeeded'))).toEqual({
      providerRef: 'ref-1',
      status: 'succeeded',
      amount: 104_400n,
      currency: 'RUB',
    });
    expect(calls[0]!.url).toBe('https://api.yookassa.ru/v3/payments/yk-1');
    expect(calls[0]!.init.headers.Authorization).toMatch(/^Basic /);
  });

  it('уведомление «оплачено», а платёж у ЮKassa ещё ждёт — ничего не делаем', async () => {
    stubFetch(() => ({ status: 200, json: payment({ status: 'pending' }) }));
    expect(await new YooKassaProvider().parseWebhook(note('payment.succeeded'))).toBe('ignore');
  });

  it('отмена — платёж неудачный', async () => {
    stubFetch(() => ({ status: 200, json: payment({ status: 'canceled' }) }));
    expect(await new YooKassaProvider().parseWebhook(note('payment.canceled'))).toMatchObject({
      status: 'failed',
    });
  });

  it('чужой или выдуманный платёж, кривое тело — подделка', async () => {
    stubFetch(() => ({ status: 404, json: { type: 'error' } }));
    expect(await new YooKassaProvider().parseWebhook(note('payment.succeeded', 'nope'))).toBeNull();
    stubFetch(() => ({ status: 200, json: payment({ status: 'succeeded', metadata: {} }) }));
    expect(await new YooKassaProvider().parseWebhook(note('payment.succeeded'))).toBeNull();
    expect(
      await new YooKassaProvider().parseWebhook({
        event: 'payment.succeeded',
        object: { id: '../x' },
      }),
    ).toBeNull();
    expect(await new YooKassaProvider().parseWebhook('hello')).toBeNull();
  });

  it('события не про оплату не запрашивают API', async () => {
    const calls = stubFetch(() => ({ status: 200, json: payment() }));
    expect(await new YooKassaProvider().parseWebhook(note('refund.succeeded'))).toBe('ignore');
    expect(calls).toHaveLength(0);
  });

  it('ЮKassa недоступна — ошибка: она повторит уведомление позже', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('ECONNRESET'))),
    );
    await expect(new YooKassaProvider().parseWebhook(note('payment.succeeded'))).rejects.toThrow(
      /не ответил/,
    );
  });
});

describe('реестр', () => {
  it('ЮKassa регистрируется только с ключами магазина', () => {
    const withKeys = new PaymentProviderRegistry(new MockPaymentProvider(), new YooKassaProvider());
    expect(withKeys.get('yookassa').key).toBe('yookassa');
    delete process.env.YOOKASSA_SECRET_KEY;
    const without = new PaymentProviderRegistry(new MockPaymentProvider(), new YooKassaProvider());
    expect(() => without.get('yookassa')).toThrow();
  });
});
