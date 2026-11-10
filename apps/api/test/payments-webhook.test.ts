import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentProvider, WebhookEvent } from '../src/modules/payments/payment.provider';
import { MockPaymentProvider } from '../src/modules/payments/mock.provider';
import { PaymentProviderRegistry } from '../src/modules/payments/provider.registry';
import { PaymentsService } from '../src/modules/payments/payments.service';

/**
 * Кто может сказать «оплачено».
 *
 * Заглушка платежей зарегистрирована всегда, а её dev-кнопка
 * `POST /payments/mock/callback` открыта без входа. Пока платежи идут через
 * неё, это удобно. Но вебхук не сверял, каким провайдером создан платёж, —
 * и с подключённым настоящим провайдером любой мог создать пополнение баланса
 * на миллион, «оплатить» его заглушкой и вывести настоящие деньги.
 */

const ENV = { ...process.env };

/** Боевой провайдер: событие — тело как есть, проверяется не подпись. Криптовалюты нет. */
const realProvider: PaymentProvider = {
  key: 'yookassa',
  methods: ['sbp', 'card'],
  createDeposit: vi.fn(async (i) => ({ providerRef: i.providerRef, url: 'https://pay.example/x', redirect: true, externalId: 'ext-1' })),
  parseWebhook: async (b) => b as WebhookEvent | 'ignore',
};

function setup(payment: Record<string, unknown>, order?: Record<string, unknown>) {
  const state = { payment: { ...payment }, created: [] as Record<string, unknown>[] };
  const prisma: Record<string, unknown> = {
    payment: {
      findUnique: vi.fn(async () => state.payment),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => state.created.push(data)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.payment, data)),
      // условная отметка «оплачен»: второй раз платёж не проводится
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.payment.status === 'succeeded') return { count: 0 };
        Object.assign(state.payment, data);
        return { count: 1 };
      }),
    },
    order: { findUnique: vi.fn(async () => order ?? null) },
    user: { findUnique: vi.fn(async () => ({ email: 'buyer@e.test' })) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const orders = {
    capturePayment: vi.fn(async () => 'paid' as const),
    afterCapture: vi.fn(async () => undefined),
  };
  const ledger = { post: vi.fn(async (_input: { legs: Array<{ account: { kind: string }; amount: bigint }> }) => undefined) };
  const mock = new MockPaymentProvider();
  const registry = new PaymentProviderRegistry(mock);
  registry.register(realProvider);
  const svc = new PaymentsService(prisma as never, registry, mock, orders as never, ledger as never);
  return { svc, state, orders, ledger, mock };
}

const BALANCE_TOPUP = {
  id: 'p1',
  userId: 'u1',
  orderId: null,
  provider: 'yookassa',
  providerRef: 'ref-1',
  amount: 100_000_000n,
  surcharge: 0n,
  method: 'sbp',
  currency: 'RUB',
  status: 'pending',
};

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.PAYMENT_PROVIDER;
});
afterEach(() => {
  process.env = { ...ENV };
});

describe('подтверждение оплаты', () => {
  it('заглушка не подтверждает платёж настоящего провайдера', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, mock, state, ledger } = setup(BALANCE_TOPUP);
    const forged = { providerRef: 'ref-1', status: 'succeeded' as const, signature: mock.sign('ref-1', 'succeeded') };

    await expect(svc.handleWebhook('mock', forged)).rejects.toThrow(/другим провайдером/);
    expect(state.payment.status).toBe('pending');
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('dev-кнопка «оплачено» закрыта, когда платежи идут не через заглушку', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, state, ledger } = setup(BALANCE_TOPUP);

    await expect(svc.devConfirm('ref-1')).rejects.toThrow();
    expect(state.payment.status).toBe('pending');
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('свой провайдер подтверждает свой платёж: деньги на баланс', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, state, ledger } = setup(BALANCE_TOPUP);

    await svc.handleWebhook('yookassa', { providerRef: 'ref-1', status: 'succeeded', signature: 'ok' });
    expect(state.payment.status).toBe('succeeded');
    expect(ledger.post).toHaveBeenCalledTimes(1);
  });

  it('на демо-стенде dev-кнопка оплачивает заказ, как и раньше', async () => {
    const { svc, orders } = setup({ ...BALANCE_TOPUP, provider: 'mock', orderId: 'o1' });

    await svc.devConfirm('ref-1');
    expect(orders.capturePayment).toHaveBeenCalledTimes(1);
    expect(orders.afterCapture).toHaveBeenCalledWith('o1', 'paid');
  });

  it('повторный вебхук того же платежа деньги второй раз не проводит', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, ledger } = setup(BALANCE_TOPUP);
    const event = { providerRef: 'ref-1', status: 'succeeded' as const, signature: 'ok' };

    await svc.handleWebhook('yookassa', event);
    // вторая доставка застала платёж ещё «в ожидании» — отсекает условная отметка
    const second = await svc.handleWebhook('yookassa', event);
    expect(second).toMatchObject({ alreadyProcessed: true });
    expect(ledger.post).toHaveBeenCalledTimes(1);
  });
});

describe('способ оплаты', () => {
  const ORDER = { id: 'o1', buyerId: 'u1', amount: 100_000n, currency: 'RUB', status: 'created' };

  it('картой шлюз берёт сумму заказа плюс 4.4%, СБП — ровно сумму', async () => {
    const { svc, state } = setup(BALANCE_TOPUP, ORDER);
    const card = await svc.createDeposit('o1', 'u1', 'card');
    expect(card).toMatchObject({ amount: '104400', surcharge: '4400', method: 'card' });
    expect(state.created[0]).toMatchObject({ amount: 104_400n, surcharge: 4_400n, method: 'card' });

    const sbp = await svc.createDeposit('o1', 'u1', 'sbp');
    expect(sbp).toMatchObject({ amount: '100000', surcharge: '0' });
  });

  it('пополнение картой: на баланс — сумма без надбавки, надбавка — платёжке', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, ledger } = setup({ ...BALANCE_TOPUP, amount: 104_400n, surcharge: 4_400n, method: 'card' });

    await svc.handleWebhook('yookassa', { providerRef: 'ref-1', status: 'succeeded', signature: 'ok' });
    const legs = ledger.post.mock.calls[0]![0].legs;
    expect(legs.find((l) => l.account.kind === 'available')?.amount).toBe(100_000n);
    expect(legs.find((l) => l.account.kind === 'fees_payable')?.amount).toBe(4_400n);
  });
});

describe('настоящий шлюз', () => {
  const ORDER = { id: 'o1', buyerId: 'u1', amount: 100_000n, currency: 'RUB', status: 'created', publicNumber: 'GM-1' };

  it('переход на страницу шлюза, номер платежа у шлюза сохраняется', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, state } = setup(BALANCE_TOPUP, ORDER);
    const dep = await svc.createDeposit('o1', 'u1', 'sbp');
    expect(dep).toMatchObject({ redirect: true, url: 'https://pay.example/x', amount: '100000' });
    expect(realProvider.createDeposit).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: 'Заказ GM-1 на GameMarket', returnUrl: expect.stringMatching(/\/orders\/o1\?paid=1$/) }),
    );
    expect(state.payment.externalId).toBe('ext-1');
  });

  it('способ, которого у шлюза нет, не принимается', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, state } = setup(BALANCE_TOPUP, ORDER);
    await expect(svc.createDeposit('o1', 'u1', 'crypto')).rejects.toThrow(/недоступен/);
    expect(state.created).toHaveLength(0);
  });

  it('шлюз не принял платёж — платёж помечен неудачным', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, state } = setup({ ...BALANCE_TOPUP }, ORDER);
    vi.mocked(realProvider.createDeposit).mockRejectedValueOnce(new Error('шлюз упал'));
    await expect(svc.createBalanceDeposit('u1', 50_000n, 'card')).rejects.toThrow('шлюз упал');
    expect(state.payment.status).toBe('failed');
  });

  it('сумма от шлюза не совпала с платежом — деньги не проводятся', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, state, ledger } = setup(BALANCE_TOPUP);
    await expect(
      svc.handleWebhook('yookassa', { providerRef: 'ref-1', status: 'succeeded', amount: 100n, currency: 'RUB' }),
    ).rejects.toThrow(/не совпадает/);
    expect(state.payment.status).toBe('pending');
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('совпала — проводится; событие «не про оплату» принимается без действий', async () => {
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const { svc, state, ledger } = setup(BALANCE_TOPUP);
    expect(await svc.handleWebhook('yookassa', 'ignore')).toMatchObject({ ignored: true });
    expect(ledger.post).not.toHaveBeenCalled();
    await svc.handleWebhook('yookassa', { providerRef: 'ref-1', status: 'succeeded', amount: 100_000_000n, currency: 'RUB' });
    expect(state.payment.status).toBe('succeeded');
    expect(ledger.post).toHaveBeenCalledTimes(1);
  });
});
