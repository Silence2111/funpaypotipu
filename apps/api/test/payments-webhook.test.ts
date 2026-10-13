import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentProvider } from '../src/modules/payments/payment.provider';
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

/** Боевой провайдер: принимает любую подпись — проверяется не она. */
const realProvider: PaymentProvider = {
  key: 'yookassa',
  createDeposit: async (i) => ({ providerRef: i.providerRef, url: 'https://pay.example/x' }),
  verifyWebhook: (p) => ({ providerRef: p.providerRef, status: p.status }),
};

function setup(payment: Record<string, unknown>) {
  const state = { payment: { ...payment } };
  const prisma = {
    payment: {
      findUnique: vi.fn(async () => state.payment),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.payment, data)),
    },
  };
  const orders = { markPaid: vi.fn(async () => undefined) };
  const ledger = { post: vi.fn(async () => undefined) };
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
    expect(orders.markPaid).toHaveBeenCalledWith('o1');
  });
});
