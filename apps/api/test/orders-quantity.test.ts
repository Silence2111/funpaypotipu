import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeFees } from '@gamemarket/shared';
import { OrdersService } from '../src/modules/orders/orders.service';

/**
 * Продажа поштучно: валюта «15 ₽ за 1000 золота», несколько ключей в заказе.
 *
 * Деньги здесь зависят от количества, а наличие — общее на всех покупателей.
 * Проверяется: сумма за количество, границы заказа, списание наличия при
 * оплате (последнюю единицу получает один покупатель, второй — деньги назад),
 * возврат наличия, когда товар не ушёл.
 *
 * Prisma и соседние сервисы подменены: проверяются правила заказа.
 */

const GOLD = {
  id: 'l-gold',
  sellerId: 'seller',
  status: 'active',
  title: 'Золото WoW, сервер Гордунни',
  price: 1_500n, // 15 ₽ за 1000 золота
  currency: 'RUB',
  categoryId: 'cat-gold',
  fulfillmentType: 'manual',
  topupMarkupBps: null,
  topupMin: null,
  topupMax: null,
  unitName: 'золота',
  pricePerUnits: 1000,
  minQty: 10_000,
  stock: 250_000,
  game: { slug: 'wow' },
  category: { fulfillmentType: 'manual' },
};

const ACCOUNT = {
  ...GOLD,
  id: 'l-acc',
  title: 'Аккаунт CS2, Prime',
  price: 99_000n,
  unitName: null,
  pricePerUnits: 1,
  minQty: 1,
  stock: null,
};

const KEYS = {
  ...ACCOUNT,
  id: 'l-keys',
  title: 'Ключ Steam, случайная игра',
  price: 4_900n,
  fulfillmentType: 'auto_key',
  stock: 5,
  category: { fulfillmentType: 'auto_key' },
};

function setup(listing: Record<string, unknown>, order: Record<string, unknown> = {}) {
  const state = {
    listing: { ...listing },
    order: {
      id: 'o1',
      publicNumber: 'GM-TEST',
      buyerId: 'buyer',
      sellerId: 'seller',
      listingId: listing.id,
      currency: 'RUB',
      feeBuyer: 0n,
      feeSeller: 0n,
      sellerPayoutAmount: 0n,
      ...order,
    },
    created: [] as Record<string, unknown>[],
    sys: [] as string[],
  };
  const matches = (where: Record<string, unknown>) => {
    const l = state.listing as Record<string, unknown> & { stock: number | null };
    const stock = where.stock as number | { gte?: number; lte?: number } | undefined;
    if (where.status !== undefined && l.status !== where.status) return false;
    if (typeof stock === 'number') return l.stock === stock;
    if (stock?.gte !== undefined) return l.stock != null && l.stock >= stock.gte;
    if (stock?.lte !== undefined) return l.stock != null && l.stock <= stock.lte;
    return true;
  };
  const apply = (data: Record<string, unknown>) => {
    const l = state.listing as Record<string, unknown> & { stock: number };
    const { stock, ...rest } = data as { stock?: number | { increment?: number; decrement?: number } };
    if (typeof stock === 'object') l.stock += (stock.increment ?? 0) - (stock.decrement ?? 0);
    else if (stock !== undefined) l.stock = stock;
    Object.assign(l, rest);
  };
  const prisma = {
    listing: {
      findUnique: vi.fn(async () => state.listing),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        apply(data);
        return state.listing;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(where)) return { count: 0 };
        apply(data);
        return { count: 1 };
      }),
    },
    order: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        return { id: 'o1', ...data };
      }),
      findUnique: vi.fn(async () => state.order),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.order, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
        if (where.status && state.order.status !== where.status) return { count: 0 };
        Object.assign(state.order, data);
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const ledger = { post: vi.fn(async () => undefined), balanceOf: vi.fn(async () => 10_000_000n), assertNotOverdrawn: vi.fn(async () => undefined) };
  const fees = { computeForCategory: vi.fn(async (base: bigint) => computeFees(base, 0, 0.1)) };
  const notifications = { notify: vi.fn(async () => undefined) };
  const chat = { postSystem: vi.fn(async (_id: string, text: string) => state.sys.push(text)) };
  const svc = new OrdersService(
    prisma as never,
    ledger as never,
    fees as never,
    { autoFulfill: vi.fn(async () => undefined) } as never,
    {} as never, // encryption
    { consume: vi.fn(async () => 0n) } as never,
    notifications as never,
    chat as never,
  );
  return { svc, state, ledger, notifications };
}

beforeEach(() => vi.clearAllMocks());

describe('заказ количеством', () => {
  it('25 000 золота по 15 ₽ за 1000 — заказ на 375 ₽, количество и цена пачки в заказе', async () => {
    const { svc, state } = setup(GOLD);
    const order = await svc.create('buyer', GOLD.id, { qty: 25_000 });
    expect(order.amount).toBe(37_500n);
    expect(state.created[0]).toMatchObject({
      qty: 25_000,
      listingSnapshot: { unitName: 'золота', unitPrice: '1500', pricePerUnits: 1000 },
    });
  });

  it('без количества берётся минимум лота', async () => {
    const { svc, state } = setup(GOLD);
    await svc.create('buyer', GOLD.id);
    expect(state.created[0]).toMatchObject({ qty: 10_000, amount: 15_000n });
  });

  it('меньше минимума и больше наличия — заказ не создаётся', async () => {
    const { svc, state } = setup(GOLD);
    await expect(svc.create('buyer', GOLD.id, { qty: 5_000 })).rejects.toThrow(/Минимум/);
    await expect(svc.create('buyer', GOLD.id, { qty: 300_000 })).rejects.toThrow(/только 250/);
    expect(state.created).toHaveLength(0);
  });

  it('лот целиком количеством не покупается', async () => {
    const { svc } = setup(ACCOUNT);
    await expect(svc.create('buyer', ACCOUNT.id, { qty: 2 })).rejects.toThrow(/целиком/);
  });

  it('лот целиком без наличия и распроданный лот — «закончился»', async () => {
    await expect(setup({ ...ACCOUNT, stock: 0 }).svc.create('buyer', ACCOUNT.id)).rejects.toThrow(/закончился/);
    await expect(setup({ ...GOLD, status: 'sold_out', stock: 0 }).svc.create('buyer', GOLD.id)).rejects.toThrow(
      /закончился/,
    );
  });

  it('скидка за количество: ступень по количеству, сумма со скидкой, ступень — в заказе', async () => {
    const tiered = {
      ...GOLD,
      qtyDiscounts: [
        { from: 50_000, pct: 10 },
        { from: 20_000, pct: 5 },
      ],
    };
    const { svc, state } = setup(tiered);
    // 25 000 золота — 375 ₽, −5% — 356,25 ₽.
    expect((await svc.create('buyer', GOLD.id, { qty: 25_000 })).amount).toBe(35_625n);
    expect(state.created[0]).toMatchObject({
      listingSnapshot: { qtyDiscount: { from: 20_000, pct: 5, discount: '1875' } },
    });
    // 60 000 — 900 ₽, −10% — 810 ₽; комиссия продавца — с 810.
    const big = await svc.create('buyer', GOLD.id, { qty: 60_000 });
    expect(big.amount).toBe(81_000n);
    expect(big.sellerPayoutAmount).toBe(computeFees(81_000n, 0, 0.1).sellerPayout);
    // Ниже первой ступени — без скидки и без отметки.
    expect((await svc.create('buyer', GOLD.id, { qty: 10_000 })).amount).toBe(15_000n);
    expect(state.created[2]!.listingSnapshot).not.toHaveProperty('qtyDiscount');
  });

  it('ключи: несколько штук в одном заказе, но не больше склада', async () => {
    const { svc } = setup(KEYS);
    const order = await svc.create('buyer', KEYS.id, { qty: 3 });
    expect(order.amount).toBe(14_700n);
    await expect(svc.create('buyer', KEYS.id, { qty: 6 })).rejects.toThrow(/только 5/);
  });
});

describe('наличие при оплате', () => {
  const PAYING = { status: 'created', fulfillmentType: 'manual', qty: 50_000, amount: 75_000n };

  it('оплата списывает количество с наличия, продавец видит его в чате', async () => {
    const { svc, state } = setup(GOLD, { ...PAYING, listingSnapshot: { unitName: 'золота' } });
    await svc.payFromBalance('o1', 'buyer');
    expect(state.order.status).toBe('paid');
    expect(state.listing.stock).toBe(200_000);
    expect(state.listing.status).toBe('active');
    expect(state.sys.at(-1)).toMatch(/Количество: 50\s000 золота/);
  });

  it('последняя пачка продана — лот уходит из каталога сам', async () => {
    const { svc, state } = setup({ ...GOLD, stock: 50_000 }, PAYING);
    await svc.payFromBalance('o1', 'buyer');
    expect(state.listing.stock).toBe(0);
    expect(state.listing.status).toBe('sold_out');
  });

  it('пока шла оплата, товар раскупили — деньги сразу назад, а не ждать сутки выдачи', async () => {
    const { svc, state, ledger, notifications } = setup({ ...GOLD, stock: 20_000 }, PAYING);
    await svc.payFromBalance('o1', 'buyer');
    expect(state.order.status).toBe('refunded');
    expect(state.listing.stock).toBe(20_000);
    const refund = ledger.post.mock.calls[1]![0] as { idempotencyKey: string; refType: string };
    expect(refund).toMatchObject({ idempotencyKey: 'refund:o1', refType: 'oos_refund' });
    expect(notifications.notify).toHaveBeenCalledWith('buyer', 'order_refunded', { orderId: 'o1', reason: 'out_of_stock' });
    // продавцу «оплачен» не приходит: продавать нечего
    expect(notifications.notify).not.toHaveBeenCalledWith('seller', 'order_paid', expect.anything());
  });

  it('у лота без наличия (null) списывать нечего', async () => {
    const { svc, state } = setup(ACCOUNT, { ...PAYING, qty: 1, amount: 99_000n });
    await svc.payFromBalance('o1', 'buyer');
    expect(state.order.status).toBe('paid');
    expect(state.listing.stock).toBeNull();
  });
});

describe('возврат наличия', () => {
  const PAID = { status: 'paid', fulfillmentType: 'manual', qty: 50_000, amount: 75_000n };

  it('отмена оплаченного заказа возвращает количество, распроданный лот снова в продаже', async () => {
    const { svc, state } = setup({ ...GOLD, stock: 0, status: 'sold_out' }, PAID);
    await svc.cancel('o1', 'buyer');
    expect(state.order.status).toBe('refunded');
    expect(state.listing.stock).toBe(50_000);
    expect(state.listing.status).toBe('active');
  });

  it('возврат продавцом до выдачи возвращает наличие', async () => {
    const { svc, state } = setup(GOLD, PAID);
    await svc.refundBySeller('o1', 'seller');
    expect(state.listing.stock).toBe(300_000);
  });

  it('возврат после выдачи наличие не трогает: товар уже у покупателя', async () => {
    const { svc, state } = setup(GOLD, { ...PAID, status: 'delivered' });
    await svc.refundBySeller('o1', 'seller');
    expect(state.order.status).toBe('refunded');
    expect(state.listing.stock).toBe(250_000);
  });
});
