import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeFees, topupQuote } from '@gamemarket/shared';
import { OrdersService } from '../src/modules/orders/orders.service';

/**
 * Заказ по лоту «на сумму покупателя» — то, что создаёт виджет пополнения
 * на главной. Цена считается из номинала и наценки продавца той же функцией,
 * что и на кнопке «Оплатить N ₽»; номинал записывается в заказ, чтобы
 * провайдер зачислил именно его.
 *
 * Prisma и соседние сервисы подменены: проверяются правила заказа.
 */

const STEAM_OFFER = {
  id: 'l-steam',
  sellerId: 'seller',
  status: 'active',
  title: 'Пополнение кошелька Steam',
  price: 10_800n,
  currency: 'RUB',
  categoryId: 'cat-topup',
  fulfillmentType: 'provider',
  topupMarkupBps: 800,
  topupMin: 10_000n,
  topupMax: 1_500_000n,
  game: { slug: 'steam' },
};

const FIXED_TOPUP = {
  ...STEAM_OFFER,
  id: 'l-fixed',
  title: 'Кристаллы сотворения, 3280',
  price: 419_000n,
  topupMarkupBps: null,
  topupMin: null,
  topupMax: null,
  game: { slug: 'genshin' },
};

function setup(listing: Record<string, unknown>) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    listing: { findUnique: vi.fn(async () => listing) },
    order: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'o1', ...data };
      }),
    },
  };
  // Комиссия 10% с продавца, как глобальное правило из сида.
  const fees = {
    computeForCategory: vi.fn(async (base: bigint) => computeFees(base, 0, 0.1)),
  };
  const svc = new OrdersService(
    prisma as never,
    {} as never, // ledger: при создании заказа не используется
    fees as never,
    {} as never, // fulfillment
    {} as never, // encryption
    { consume: vi.fn(async () => 0n) } as never,
    { notify: vi.fn(async () => undefined) } as never,
    { postSystem: vi.fn(async () => undefined) } as never,
  );
  return { svc, created, fees };
}

beforeEach(() => vi.clearAllMocks());

describe('заказ пополнения на сумму покупателя', () => {
  it('цена — номинал плюс наценка, как на кнопке виджета', async () => {
    const { svc, created } = setup(STEAM_OFFER);
    const order = await svc.create('buyer', STEAM_OFFER.id, {
      account: 'gamer_2007',
      topupAmount: '100000',
    });
    expect(order.amount).toBe(topupQuote(100_000n, 800).price);
    expect(order.amount).toBe(108_000n);
    expect(created).toHaveLength(1);
  });

  it('комиссия площадки считается с цены, продавец получает цену минус комиссия', async () => {
    const { svc, fees } = setup(STEAM_OFFER);
    const order = await svc.create('buyer', STEAM_OFFER.id, {
      account: 'gamer_2007',
      topupAmount: '100000',
    });
    expect(fees.computeForCategory).toHaveBeenCalledWith(108_000n, 'cat-topup', 'RUB', 'seller');
    expect(order.sellerPayoutAmount).toBe(108_000n - 10_800n);
  });

  it('номинал и логин записаны в заказ — их получит провайдер', async () => {
    const { svc, created } = setup(STEAM_OFFER);
    await svc.create('buyer', STEAM_OFFER.id, { account: '  gamer_2007 ', topupAmount: '250000' });
    expect(created[0]!.listingSnapshot).toMatchObject({
      account: 'gamer_2007',
      topupAmount: '250000',
      basePrice: topupQuote(250_000n, 800).price.toString(),
    });
  });

  it('без суммы заказ не создаётся', async () => {
    const { svc, created } = setup(STEAM_OFFER);
    await expect(svc.create('buyer', STEAM_OFFER.id, { account: 'gamer_2007' })).rejects.toThrow(
      /Укажите сумму/,
    );
    expect(created).toHaveLength(0);
  });

  it('сумма за границами лота — отказ с границей в тексте', async () => {
    const { svc } = setup(STEAM_OFFER);
    await expect(
      svc.create('buyer', STEAM_OFFER.id, { account: 'gamer_2007', topupAmount: '5000' }),
    ).rejects.toThrow(/Минимум/);
    await expect(
      svc.create('buyer', STEAM_OFFER.id, { account: 'gamer_2007', topupAmount: '2000000' }),
    ).rejects.toThrow(/Максимум/);
  });

  it('почта вместо логина Steam ловится до оплаты', async () => {
    const { svc } = setup(STEAM_OFFER);
    await expect(
      svc.create('buyer', STEAM_OFFER.id, { account: 'me@mail.ru', topupAmount: '100000' }),
    ).rejects.toThrow(/а не почта/);
  });

  it('у лота с фиксированной ценой сумму не выбирают', async () => {
    const { svc } = setup(FIXED_TOPUP);
    await expect(
      svc.create('buyer', FIXED_TOPUP.id, { account: '812345678', topupAmount: '100000' }),
    ).rejects.toThrow(/фиксированная цена/);
  });

  it('лот с фиксированной ценой продаётся по своей цене, как раньше', async () => {
    const { svc, created } = setup(FIXED_TOPUP);
    const order = await svc.create('buyer', FIXED_TOPUP.id, { account: '812345678' });
    expect(order.amount).toBe(419_000n);
    expect(created[0]!.listingSnapshot).not.toHaveProperty('topupAmount');
  });
});
