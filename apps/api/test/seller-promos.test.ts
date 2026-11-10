import { describe, expect, it, vi } from 'vitest';
import { MAX_SELLER_PROMOS } from '@gamemarket/shared';
import { SellerPromosService } from '../src/modules/promo/seller-promos.service';

/**
 * Промокоды продавца. Проверяется: код — латиница и цифры, в верхнем
 * регистре, не повторяется, не больше предела; проверка кода для заказа:
 * чужой код — null (может быть кодом площадки), выключенный, истёкший,
 * пополнение, исчерпанный, уже использованный покупателем и «только
 * постоянным» без сделок — отказ с причиной; под заказом — блокировка.
 */

type Row = Record<string, unknown>;

function setup(
  opts: {
    promo?: Row | null;
    uses?: number;
    mine?: number;
    completed?: number;
    count?: number;
  } = {},
) {
  const prisma = {
    sellerPromo: {
      findUnique: vi.fn(async () => opts.promo ?? null),
      count: vi.fn(async () => opts.count ?? 0),
      create: vi.fn(async ({ data }: { data: Row }) => ({ id: 'p1', ...data })),
    },
    sellerPromoUse: {
      count: vi.fn(async ({ where }: { where: Row }) =>
        where.buyerId ? (opts.mine ?? 0) : (opts.uses ?? 0),
      ),
    },
    order: { count: vi.fn(async () => opts.completed ?? 0) },
    $queryRaw: vi.fn(async () => []),
  };
  return { svc: new SellerPromosService(prisma as never), prisma };
}

const promo = (over: Row = {}): Row => ({
  id: 'p1',
  code: 'SUMMER10',
  percent: 10,
  maxUses: null,
  validUntil: null,
  repeatOnly: false,
  active: true,
  ...over,
});
const lot = { sellerId: 's1', topupMarkupBps: null };

describe('создание промокода', () => {
  it('в верхнем регистре; латиница и цифры; без повторов; не больше предела', async () => {
    const { svc, prisma } = setup();
    expect(await svc.create('s1', { code: ' summer10 ', percent: 10, days: 7 })).toMatchObject({
      code: 'SUMMER10',
      used: 0,
    });
    const data = prisma.sellerPromo.create.mock.calls[0]![0].data as { validUntil: Date };
    expect(data.validUntil.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
    await expect(setup().svc.create('s1', { code: 'ЛЕТО', percent: 10 })).rejects.toThrow(
      /латинских/,
    );
    await expect(
      setup({ promo: promo() }).svc.create('s1', { code: 'summer10', percent: 10 }),
    ).rejects.toThrow('Такой код у вас уже есть');
    await expect(
      setup({ count: MAX_SELLER_PROMOS }).svc.create('s1', { code: 'NEW1', percent: 10 }),
    ).rejects.toThrow(/Не больше/);
  });
});

describe('код продавца в заказе', () => {
  it('нет у продавца — null: это может быть код площадки', async () => {
    expect(await setup().svc.check('START10', lot, 'b1')).toBeNull();
  });

  it('подходит — процент; под заказом код блокируется', async () => {
    const { svc, prisma } = setup({ promo: promo() });
    expect(await svc.check('summer10', lot, 'b1', undefined, true)).toEqual({
      id: 'p1',
      code: 'SUMMER10',
      percent: 10,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('выключен, истёк, пополнение, закончился, уже использован, не постоянный — отказ с причиной', async () => {
    const check = (o: Parameters<typeof setup>[0], l: Row = lot) =>
      setup(o).svc.check('SUMMER10', l as typeof lot, 'b1');
    await expect(check({ promo: promo({ active: false }) })).rejects.toThrow(/выключил/);
    await expect(
      check({ promo: promo({ validUntil: new Date(Date.now() - 1000) }) }),
    ).rejects.toThrow(/истёк/);
    await expect(
      check({ promo: promo() }, { sellerId: 's1', topupMarkupBps: 650 }),
    ).rejects.toThrow(/пополнение/);
    await expect(check({ promo: promo({ maxUses: 5 }), uses: 5 })).rejects.toThrow(/закончился/);
    await expect(check({ promo: promo(), mine: 1 })).rejects.toThrow(/уже покупали/);
    await expect(check({ promo: promo({ repeatOnly: true }), completed: 0 })).rejects.toThrow(
      /уже покупал у этого/,
    );
    expect(await check({ promo: promo({ repeatOnly: true }), completed: 2 })).toMatchObject({
      percent: 10,
    });
  });

  it('счёт использований — без отменённых и истёкших заказов', async () => {
    const { svc, prisma } = setup({ promo: promo({ maxUses: 3 }), uses: 2 });
    await svc.check('SUMMER10', lot, 'b1');
    expect(prisma.sellerPromoUse.count.mock.calls[0]![0]).toMatchObject({
      where: { promoId: 'p1', order: { status: { notIn: ['cancelled', 'expired'] } } },
    });
  });
});
