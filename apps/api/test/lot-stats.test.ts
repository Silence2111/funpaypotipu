import { afterEach, describe, expect, it, vi } from 'vitest';
import { LotStatsService } from '../src/modules/lot-stats/lot-stats.service';

/**
 * Статистика лотов. Проверяется: просмотр считается только у видимого лота
 * и не у самого продавца, одной прибавкой по дню (по Москве); статистика —
 * просмотры и покупки по дням по Москве, конверсия, заработанное, лоты по
 * просмотрам; график одного лота — только его, чужой лот — 404.
 */

type Row = Record<string, unknown>;

afterEach(() => {
  vi.useRealTimers();
});

function setup(
  opts: {
    listing?: Row | null;
    lots?: Row[];
    viewsByLot?: Row[];
    viewsByDay?: Row[];
    favs?: Row[];
    paid?: Row[];
    earned?: Row[];
  } = {},
) {
  const prisma = {
    listing: {
      findUnique: vi.fn(async () => opts.listing ?? null),
      findMany: vi.fn(async () => opts.lots ?? []),
    },
    listingViewDay: {
      groupBy: vi.fn(async ({ by }: { by: string[] }) =>
        by[0] === 'listingId' ? (opts.viewsByLot ?? []) : (opts.viewsByDay ?? []),
      ),
    },
    favorite: { groupBy: vi.fn(async () => opts.favs ?? []) },
    order: {
      findMany: vi.fn(async () => opts.paid ?? []),
      groupBy: vi.fn(async () => opts.earned ?? []),
    },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  };
  return { svc: new LotStatsService(prisma as never), prisma };
}

describe('просмотр лота', () => {
  it('у видимого лота — прибавка по московскому дню и к общему счётчику', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T22:30:00Z')); // в Москве уже 22-е
    const { svc, prisma } = setup({ listing: { sellerId: 's1', status: 'active' } });
    expect(await svc.recordView('l1', 'buyer')).toEqual({ counted: true });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw.mock.calls[0]).toContain('2026-10-22');
  });

  it('свой просмотр, снятый и несуществующий лот — не в счёт', async () => {
    const own = setup({ listing: { sellerId: 's1', status: 'active' } });
    expect(await own.svc.recordView('l1', 's1')).toEqual({ counted: false });
    const paused = setup({ listing: { sellerId: 's1', status: 'paused' } });
    expect(await paused.svc.recordView('l1', null)).toEqual({ counted: false });
    const none = setup({ listing: null });
    expect(await none.svc.recordView('l1', null)).toEqual({ counted: false });
    expect(own.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(paused.prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('статистика продавца', () => {
  const lot = (id: string, over: Row = {}): Row => ({
    id,
    title: `Лот ${id}`,
    status: 'active',
    price: 100000n,
    currency: 'RUB',
    unitName: null,
    pricePerUnits: 1,
    topupMarkupBps: null,
    viewsCount: 500,
    ...over,
  });

  it('по лотам — просмотры, избранное, покупки, конверсия, заработанное; по дням — по Москве', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const { svc } = setup({
      lots: [lot('a'), lot('b')],
      viewsByLot: [
        { listingId: 'a', _sum: { views: 40 } },
        { listingId: 'b', _sum: { views: 160 } },
      ],
      viewsByDay: [
        { day: new Date('2026-10-20T00:00:00Z'), _sum: { views: 120 } },
        { day: new Date('2026-10-21T00:00:00Z'), _sum: { views: 80 } },
      ],
      favs: [{ listingId: 'a', _count: { _all: 3 } }],
      paid: [
        { listingId: 'b', paidAt: new Date('2026-10-19T21:30:00Z') }, // 20-е по Москве
        { listingId: 'b', paidAt: new Date('2026-10-21T08:00:00Z') },
        { listingId: 'a', paidAt: new Date('2026-10-21T09:00:00Z') },
      ],
      earned: [{ listingId: 'b', _sum: { sellerPayoutAmount: 180000n } }],
    });
    const s = await svc.sellerStats('s1', 7);
    expect(s.from).toBe('2026-10-15');
    expect(s.to).toBe('2026-10-21');
    expect(
      s.lots.map((l) => [l.id, l.views, l.favorites, l.purchases, l.conversion, l.earned]),
    ).toEqual([
      ['b', 160, 0, 2, 1.3, '180000'],
      ['a', 40, 3, 1, 2.5, '0'],
    ]);
    expect(s.totals).toEqual({
      views: 200,
      favorites: 3,
      purchases: 3,
      earned: '180000',
      conversion: 1.5,
    });
    expect(s.daily).toHaveLength(7);
    expect(s.daily.slice(-2)).toEqual([
      { day: '2026-10-20', views: 120, purchases: 1 },
      { day: '2026-10-21', views: 80, purchases: 2 },
    ]);
  });

  it('график одного лота — только его покупки; чужой лот — 404', async () => {
    const { svc, prisma } = setup({
      lots: [lot('a'), lot('b')],
      paid: [
        { listingId: 'a', paidAt: new Date() },
        { listingId: 'b', paidAt: new Date() },
      ],
    });
    const s = await svc.sellerStats('s1', 30, 'a');
    expect(s.daily.reduce((n, d) => n + d.purchases, 0)).toBe(1);
    const byDay = prisma.listingViewDay.groupBy.mock.calls.find((c) => c[0].by[0] === 'day')!;
    expect(byDay[0]).toMatchObject({ where: { listingId: { in: ['a'] } } });
    await expect(svc.sellerStats('s1', 30, 'чужой')).rejects.toThrow('Лот не найден');
  });
});
