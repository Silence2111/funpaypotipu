import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../src/modules/orders/orders.service';

/**
 * Деньги шлюза по заказу (capturePayment) и оплата с баланса.
 *
 * Со способом оплаты у заказа может оказаться два платежа: начал СБП,
 * передумал, оплатил картой — и первый платёж тоже прошёл. Раньше второй
 * вебхук падал на переходе статуса, и его деньги нигде не числились.
 * Проверяется: заказ оплачивает ровно один платёж, остальные — на баланс
 * покупателя; надбавка способа не попадает в эскроу.
 */

type Legs = Array<{ account: { kind: string }; direction: string; amount: bigint }>;

function setup(order: Record<string, unknown>) {
  const state = { order: { ...order } };
  const tx = {
    order: {
      findUnique: vi.fn(async () => state.order),
      updateMany: vi.fn(async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
        if (where.status && state.order.status !== where.status) return { count: 0 };
        Object.assign(state.order, data);
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    ...tx,
    order: { ...tx.order },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const ledger = {
    post: vi.fn(async (_input: { legs: Legs; idempotencyKey: string; refType: string }, _tx?: unknown) => undefined),
    balanceOf: vi.fn(async () => 1_000_000n),
    assertNotOverdrawn: vi.fn(async () => undefined),
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const chat = { postSystem: vi.fn(async () => undefined) };
  const svc = new OrdersService(
    prisma as never,
    ledger as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
    chat as never,
  );
  return { svc, state, tx, ledger, notifications };
}

const ORDER = { id: 'o1', buyerId: 'b1', sellerId: 's1', amount: 100_000n, currency: 'RUB', status: 'created' };
const CARD = {
  id: 'p1',
  orderId: 'o1',
  userId: 'b1',
  providerRef: 'ref-card',
  method: 'card',
  amount: 104_400n,
  surcharge: 4_400n,
  currency: 'RUB',
};

const kindAmount = (legs: Legs, kind: string) => legs.find((l) => l.account.kind === kind)?.amount;

beforeEach(() => vi.clearAllMocks());

describe('оплата заказа через шлюз', () => {
  it('картой: в эскроу сумма заказа, надбавка — платёжке, способ записан в заказ', async () => {
    const { svc, state, tx, ledger } = setup(ORDER);
    const outcome = await svc.capturePayment(tx as never, CARD as never);
    expect(outcome).toBe('paid');
    expect(state.order).toMatchObject({ status: 'paid', paymentMethod: 'card', paymentSurcharge: 4_400n });
    const [input, passedTx] = ledger.post.mock.calls[0]!;
    expect(passedTx).toBe(tx); // одна транзакция со сменой статуса
    expect(input.idempotencyKey).toBe('pay:o1');
    expect(kindAmount(input.legs, 'escrow')).toBe(100_000n);
    expect(kindAmount(input.legs, 'fees_payable')).toBe(4_400n);
    expect(kindAmount(input.legs, 'gateway_clearing')).toBe(104_400n);
  });

  it('второй платёж по уже оплаченному заказу — на баланс покупателя, а не в никуда', async () => {
    const { svc, tx, ledger } = setup({ ...ORDER, status: 'paid' });
    const outcome = await svc.capturePayment(tx as never, { ...CARD, providerRef: 'ref-2' } as never);
    expect(outcome).toBe('late');
    const [input] = ledger.post.mock.calls[0]!;
    expect(input).toMatchObject({ idempotencyKey: 'late:ref-2', refType: 'late_payment' });
    expect(kindAmount(input.legs, 'available')).toBe(100_000n);
    expect(kindAmount(input.legs, 'escrow')).toBeUndefined();
  });

  it('оплата пришла после истечения заказа — тоже на баланс', async () => {
    const { svc, tx } = setup({ ...ORDER, status: 'expired' });
    expect(await svc.capturePayment(tx as never, CARD as never)).toBe('late');
  });

  it('покупатель узнаёт, куда делись деньги второго платежа', async () => {
    const { svc, notifications } = setup({ ...ORDER, status: 'paid' });
    await svc.afterCapture('o1', 'late');
    expect(notifications.notify).toHaveBeenCalledWith('b1', 'payment_to_balance', { orderId: 'o1' });
  });
});

describe('оплата с баланса', () => {
  it('параллельная оплата: заказ уже перехватил другой платёж — с баланса не списывается', async () => {
    const { svc, state, tx, ledger } = setup(ORDER);
    // get() видит «создан», но к моменту списания заказ уже оплачен шлюзом
    tx.order.updateMany.mockImplementationOnce(async () => {
      state.order.status = 'paid';
      return { count: 0 };
    });
    await svc.payFromBalance('o1', 'b1');
    expect(ledger.post).not.toHaveBeenCalled();
  });
});
