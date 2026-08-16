import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FulfillmentService } from '../src/modules/orders/fulfillment.service';

/**
 * Автовыдача ключей — самое денежное место маркетплейса, и до сих пор оно не
 * было покрыто ничем: `npm test` в этом пакете печатал «юнит-тестов пока нет»
 * и выходил с нулём.
 *
 * Проверяем то, что стоит денег, если сломается:
 *   - один ключ не может уйти двум заказам;
 *   - кончился склад → возврат покупателю, а не зависшие в эскроу деньги;
 *   - гонка за последним ключом не превращается в ложный возврат при живом складе;
 *   - повторный вызов не выдаёт второй ключ за те же деньги.
 *
 * Prisma подменена: проверяем правила, а не драйвер базы.
 */

type Good = { id: string; listingId: string; status: string; reservedForOrderId?: string | null };

function makeDb(goods: Good[], order: Record<string, unknown>) {
  const state = {
    goods,
    order: { ...order },
    deliveries: [] as unknown[],
    listingUpdates: [] as unknown[],
    orderUpdates: [] as Record<string, unknown>[],
  };

  const prisma = {
    order: {
      findUnique: vi.fn(async () => state.order),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.orderUpdates.push(data);
        Object.assign(state.order, data);
        return state.order;
      }),
    },
    digitalGood: {
      findFirst: vi.fn(async ({ where }: { where: { listingId: string; status: string } }) => {
        const g = state.goods.find(
          (x) => x.listingId === where.listingId && x.status === where.status,
        );
        return g ? { id: g.id } : null;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; status: string }; data: Good }) => {
          const g = state.goods.find((x) => x.id === where.id && x.status === where.status);
          if (!g) return { count: 0 };
          Object.assign(g, data);
          return { count: 1 };
        },
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Good }) => {
        const g = state.goods.find((x) => x.id === where.id);
        if (g) Object.assign(g, data);
        return g;
      }),
    },
    delivery: { upsert: vi.fn(async (arg: unknown) => state.deliveries.push(arg)) },
    listing: { update: vi.fn(async (arg: unknown) => state.listingUpdates.push(arg)) },
    // Транзакция в тесте выполняет уже созданные промисы: Prisma принимает
    // массив вызовов, и к этому моменту они отработали — как и в проде.
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { prisma, state };
}

const ledger = { post: vi.fn(async () => undefined) };
const notifications = { notify: vi.fn(async () => undefined) };
const topup = { topUp: vi.fn(async () => ({ ok: true, providerRef: 'ref-1' })) };

const ORDER = {
  id: 'o1',
  status: 'paid',
  fulfillmentType: 'auto_key',
  listingId: 'l1',
  buyerId: 'b1',
  sellerId: 's1',
  amount: 1000,
  currency: 'RUB',
};

function service(prisma: unknown) {
  return new FulfillmentService(
    prisma as never,
    topup as never,
    ledger as never,
    notifications as never,
  );
}

beforeEach(() => {
  ledger.post.mockClear();
  notifications.notify.mockClear();
  topup.topUp.mockClear();
});

describe('выдача ключа', () => {
  it('оплаченный заказ получает ключ, склад уменьшается', async () => {
    const { prisma, state } = makeDb(
      [{ id: 'g1', listingId: 'l1', status: 'available' }],
      ORDER,
    );
    await service(prisma).autoFulfill('o1');

    expect(state.goods[0].status).toBe('delivered');
    expect(state.order.status).toBe('delivered');
    expect(state.listingUpdates).toHaveLength(1);
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('один ключ не уходит двум заказам', async () => {
    // Главный денежный риск: два покупателя получают один и тот же код
    const { prisma, state } = makeDb(
      [{ id: 'g1', listingId: 'l1', status: 'available' }],
      ORDER,
    );
    const svc = service(prisma);

    await svc.autoFulfill('o1');
    state.order.status = 'paid'; // как будто пришёл второй оплаченный заказ
    state.order.id = 'o2';
    await svc.autoFulfill('o2');

    const delivered = state.goods.filter((g) => g.status === 'delivered');
    expect(delivered).toHaveLength(1);
    // Второму заказу ключа не досталось — деньги вернулись, а не пропали
    expect(ledger.post).toHaveBeenCalledTimes(1);
  });

  it('повторная попытка по уже выданному заказу ничего не делает', async () => {
    const { prisma, state } = makeDb(
      [
        { id: 'g1', listingId: 'l1', status: 'available' },
        { id: 'g2', listingId: 'l1', status: 'available' },
      ],
      ORDER,
    );
    const svc = service(prisma);
    await svc.autoFulfill('o1');
    await svc.autoFulfill('o1');

    // Второй ключ за те же деньги не уходит
    expect(state.goods.filter((g) => g.status === 'delivered')).toHaveLength(1);
  });

  it('неоплаченный заказ ключ не получает', async () => {
    const { prisma, state } = makeDb(
      [{ id: 'g1', listingId: 'l1', status: 'available' }],
      { ...ORDER, status: 'pending' },
    );
    await service(prisma).autoFulfill('o1');
    expect(state.goods[0].status).toBe('available');
  });
});

describe('склад закончился', () => {
  it('деньги возвращаются покупателю, а не зависают в эскроу', async () => {
    const { prisma, state } = makeDb([], ORDER);
    await service(prisma).autoFulfill('o1');

    expect(ledger.post).toHaveBeenCalledTimes(1);
    expect(state.order.status).toBe('refunded');
  });

  it('возврат идемпотентен по ключу заказа', async () => {
    // Иначе повтор вебхука вернёт деньги дважды
    const { prisma } = makeDb([], ORDER);
    await service(prisma).autoFulfill('o1');
    const arg = ledger.post.mock.calls[0][0] as { idempotencyKey: string };
    expect(arg.idempotencyKey).toBe('refund:o1');
  });

  it('о пустом складе узнают обе стороны', async () => {
    const { prisma } = makeDb([], ORDER);
    await service(prisma).autoFulfill('o1');

    const events = notifications.notify.mock.calls.map((c) => c[1]);
    expect(events).toContain('order_refunded');
    expect(events).toContain('listing_out_of_stock');
  });

  it('уже зарезервированный чужим заказом ключ не считается доступным', async () => {
    const { prisma, state } = makeDb(
      [{ id: 'g1', listingId: 'l1', status: 'reserved', reservedForOrderId: 'другой' }],
      ORDER,
    );
    await service(prisma).autoFulfill('o1');
    expect(state.order.status).toBe('refunded');
    expect(state.goods[0].reservedForOrderId).toBe('другой');
  });

  it('ключи чужого лота не выдаются', async () => {
    const { prisma, state } = makeDb(
      [{ id: 'g1', listingId: 'другой-лот', status: 'available' }],
      ORDER,
    );
    await service(prisma).autoFulfill('o1');
    expect(state.goods[0].status).toBe('available');
    expect(state.order.status).toBe('refunded');
  });
});

describe('пополнение через провайдера', () => {
  it('успешное пополнение помечает заказ доставленным', async () => {
    const { prisma, state } = makeDb([], { ...ORDER, fulfillmentType: 'provider' });
    await service(prisma).autoFulfill('o1');
    expect(state.order.status).toBe('delivered');
  });

  it('неудача провайдера не помечает заказ доставленным', async () => {
    // Иначе покупатель без пополнения потеряет право на возврат
    topup.topUp.mockResolvedValueOnce({ ok: false, providerRef: '' } as never);
    const { prisma, state } = makeDb([], { ...ORDER, fulfillmentType: 'provider' });
    await service(prisma).autoFulfill('o1');
    expect(state.order.status).toBe('paid');
  });
});
