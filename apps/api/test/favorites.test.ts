import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@gamemarket/db';
import { FavoritesService } from '../src/modules/favorites/favorites.service';

/**
 * Снижение цены в избранном. Проверяется: в избранное — с ценой за единицу
 * (у лота «на сумму покупателя» — без), «было» — в текущей пачке и только
 * если подешевел; проверка сдвигает точку отсчёта с прежней и только тогда
 * уведомляет — повторного уведомления от второго экземпляра API нет; сбой
 * одного лота не мешает остальным; порог — 5%.
 */

type Row = Record<string, unknown>;

function setup(opts: { listing?: Row | null; favs?: Row[]; listings?: Row[]; drops?: Row[] } = {}) {
  const prisma = {
    listing: {
      findUnique: vi.fn(async () => opts.listing ?? null),
      findMany: vi.fn(async () => opts.listings ?? []),
    },
    favorite: {
      upsert: vi.fn(async () => ({})),
      findMany: vi.fn(async () => opts.favs ?? []),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $queryRaw: vi.fn(async () => opts.drops ?? []),
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const svc = new FavoritesService(prisma as never, notifications as never);
  return { svc, prisma, notifications };
}

const drop = (over: Row = {}): Row => ({
  id: 'f1',
  user_id: 'buyer',
  listing_id: 'l1',
  watch: '1000.000000',
  price: 90000n,
  pack: 100,
  title: 'Золото 1 000',
  locale: 'ru',
  ...over,
});

describe('в избранное', () => {
  it('с ценой за единицу; у лота «на сумму покупателя» — без; повтор ничего не сбрасывает', async () => {
    const { svc, prisma } = setup({
      listing: { price: 150000n, pricePerUnits: 1000, topupMarkupBps: null },
    });
    await svc.add('buyer', 'l1');
    const call = prisma.favorite.upsert.mock.calls[0]![0] as unknown as {
      update: Row;
      create: { addedUnitPrice: Prisma.Decimal; watchUnitPrice: Prisma.Decimal };
    };
    expect(call.update).toEqual({});
    expect(call.create.addedUnitPrice.toString()).toBe('150');
    expect(call.create.watchUnitPrice.toString()).toBe('150');

    const topup = setup({ listing: { price: 10000n, pricePerUnits: 1, topupMarkupBps: 650 } });
    await topup.svc.add('buyer', 'l2');
    expect(topup.prisma.favorite.upsert.mock.calls[0]![0]).toMatchObject({
      create: { addedUnitPrice: null, watchUnitPrice: null },
    });
  });

  it('«было» — в текущей пачке и только если подешевел', async () => {
    const { svc } = setup({
      favs: [
        {
          listingId: 'cheaper',
          addedUnitPrice: new Prisma.Decimal('150'),
          createdAt: new Date('2026-10-20T10:00:00Z'),
        },
        { listingId: 'dearer', addedUnitPrice: new Prisma.Decimal('100') },
        { listingId: 'topup', addedUnitPrice: null },
      ],
      listings: [
        // Было 1 500 ₽ за 1 000, пачку сменили на 100: было 150 ₽ за 100 — сейчас 120.
        { id: 'cheaper', price: 12000n, pricePerUnits: 100, topupMarkupBps: null },
        { id: 'dearer', price: 15000n, pricePerUnits: 1, topupMarkupBps: null },
        { id: 'topup', price: 9000n, pricePerUnits: 1, topupMarkupBps: 650 },
      ],
    });
    const list = await svc.listMine('buyer');
    expect(list.map((l) => [l.id, l.wasPrice])).toEqual([
      ['cheaper', '15000'],
      ['dearer', null],
      ['topup', null],
    ]);
    // Когда добавили — для «Недавно добавленные» в кабинете.
    expect(list[0]!.addedAt).toEqual(new Date('2026-10-20T10:00:00Z'));
  });
});

describe('подешевел — уведомление', () => {
  it('порог 5%, точка отсчёта сдвигается с прежней, текст — было и стало', async () => {
    const { svc, prisma, notifications } = setup({ drops: [drop()] });
    expect(await svc.priceSweep()).toEqual({ notified: 1 });
    // Порог в запросе: цена * 100 <= отсчёт * 95.
    expect(prisma.$queryRaw.mock.calls[0]).toContain(95);
    const moved = prisma.favorite.updateMany.mock.calls[0]![0] as unknown as {
      where: { id: string; watchUnitPrice: Prisma.Decimal };
      data: { watchUnitPrice: Prisma.Decimal };
    };
    expect(moved.where.id).toBe('f1');
    expect(moved.where.watchUnitPrice.toString()).toBe('1000');
    expect(moved.data.watchUnitPrice.toString()).toBe('900');
    expect(notifications.notify).toHaveBeenCalledWith('buyer', 'price_drop', {
      listingId: 'l1',
      oldPrice: '100000',
      newPrice: '90000',
      preview: '«Золото 1 000»: было 1 000 ₽, стало 900 ₽',
    });
  });

  it('по-английски; уже сдвинутый другим экземпляром — молчит; сбой одного не мешает', async () => {
    const { svc, prisma, notifications } = setup({
      drops: [
        drop({ id: 'f1' }),
        drop({ id: 'f2', user_id: 'b2', locale: 'en' }),
        drop({ id: 'f3' }),
      ],
    });
    prisma.favorite.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('база недоступна'));
    expect(await svc.priceSweep()).toEqual({ notified: 1 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      'b2',
      'price_drop',
      expect.objectContaining({ preview: '“Золото 1 000”: was 1,000 ₽, now 900 ₽' }),
    );
  });
});
