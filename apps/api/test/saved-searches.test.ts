import { describe, expect, it, vi } from 'vitest';
import { MAX_SAVED_SEARCHES } from '@gamemarket/shared';
import { SavedSearchesService } from '../src/modules/saved-searches/saved-searches.service';

/**
 * Сохранённые поиски. Проверяется: в поиск попадают только фильтры раздела,
 * повтор и предел — отказ; новая цена и включённые уведомления считают
 * новыми лоты с этого момента. Фоновая проверка ищет тем же условием, что
 * раздел, без своих лотов и чёрного списка, о каждом лоте сообщает один раз
 * и на языке получателя; сбой одного поиска не мешает остальным.
 */

type Row = Record<string, unknown>;
const category = {
  slug: 'accounts',
  title: 'Аккаунты',
  game: { slug: 'cs2', title: 'Counter-Strike 2' },
  attributes: [
    { key: 'rank', label: 'Звание' },
    { key: 'prime', label: 'Prime' },
  ],
};

function setup(opts: { count?: number; existing?: Row[]; listings?: Row[][] } = {}) {
  const searches: Row[] = [...(opts.existing ?? [])];
  const listings = [...(opts.listings ?? [])];
  const prisma = {
    category: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'c1' ? { gameId: 'g1' } : where.id === 'c-nogame' ? { gameId: null } : null,
      ),
    },
    attribute: {
      findMany: vi.fn(async () => [
        { key: 'rank', type: 'enum', options: ['Gold', 'Global Elite'] },
        { key: 'prime', type: 'bool', options: null },
      ]),
    },
    savedSearch: {
      count: vi.fn(async () => opts.count ?? searches.length),
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        where.notify ? searches : searches.filter((s) => s.id !== (where.id as Row)?.not),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Row }) =>
          searches.find((s) => s.id === where.id && s.userId === where.userId) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `s${searches.length + 1}`,
          createdAt: new Date(),
          lastHitAt: null,
          category,
          ...data,
        };
        searches.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) =>
        Object.assign(
          searches.find((s) => s.id === where.id)!,
          data,
        ),
      ),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    listing: { findMany: vi.fn(async () => listings.shift() ?? []) },
    savedSearchHit: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => ({ count: data.length })),
    },
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const svc = new SavedSearchesService(prisma as never, notifications as never);
  return { svc, prisma, notifications, searches };
}

const saved = (over: Row = {}): Row => ({
  id: 's1',
  userId: 'buyer',
  categoryId: 'c1',
  attrs: { rank: 'Gold' },
  q: null,
  maxPrice: 150000n,
  notify: true,
  since: new Date('2026-10-20T10:00:00Z'),
  createdAt: new Date(),
  lastHitAt: null,
  category,
  user: { locale: 'ru' },
  ...over,
});

describe('сохранение поиска', () => {
  it('фильтры раздела, текст и цена; ссылка на раздел с теми же условиями', async () => {
    const { svc } = setup();
    const s = await svc.create('buyer', {
      categoryId: 'c1',
      attrs: { rank: 'Global Elite', prime: true },
      q: ' нож ',
      maxPrice: 150000,
    });
    expect(s).toMatchObject({
      attrs: { rank: 'Global Elite', prime: true },
      q: 'нож',
      maxPrice: '150000',
      notify: true,
      labels: { rank: 'Звание', prime: 'Prime' },
      path: '/igra/cs2/accounts?f_prime=1&f_rank=Global%20Elite&q=%D0%BD%D0%BE%D0%B6&max=1500',
    });
  });

  it('чужой фильтр, повтор, предел и раздел без игры — отказ', async () => {
    await expect(
      setup().svc.create('buyer', { categoryId: 'c1', attrs: { rank: 'Silver' } }),
    ).rejects.toThrow('В разделе нет такого фильтра');
    await expect(
      setup().svc.create('buyer', { categoryId: 'c1', attrs: { level: '10' } }),
    ).rejects.toThrow('В разделе нет такого фильтра');
    const { svc } = setup({ existing: [saved({ attrs: { prime: true, rank: 'Gold' } })] });
    await expect(
      svc.create('buyer', {
        categoryId: 'c1',
        attrs: { rank: 'Gold', prime: true },
        maxPrice: 150000,
      }),
    ).rejects.toThrow('Такой поиск уже сохранён');
    await expect(
      setup({ count: MAX_SAVED_SEARCHES }).svc.create('buyer', { categoryId: 'c1' }),
    ).rejects.toThrow(/Не больше/);
    await expect(setup().svc.create('buyer', { categoryId: 'c-nogame' })).rejects.toThrow(
      'Раздел не найден',
    );
  });

  it('новая цена и включённые уведомления — новыми считаются лоты с этого момента', async () => {
    const { svc, searches } = setup({ existing: [saved({ notify: false })] });
    const before = searches[0]!.since as Date;
    await svc.update('buyer', 's1', { notify: false, maxPrice: 150000 });
    expect(searches[0]!.since).toBe(before);
    await svc.update('buyer', 's1', { notify: true });
    expect((searches[0]!.since as Date).getTime()).toBeGreaterThan(before.getTime());
    const s = await svc.update('buyer', 's1', { maxPrice: null });
    expect(s.maxPrice).toBeNull();
    await expect(svc.update('other', 's1', { notify: false })).rejects.toThrow('Поиск не найден');
  });
});

describe('новые лоты по поиску', () => {
  it('тем же условием, что раздел, без своих лотов, чёрного списка и уже присланных', async () => {
    const { svc, prisma, notifications } = setup({
      existing: [saved()],
      listings: [[{ id: 'l1', title: 'Аккаунт Gold', price: 120000n }]],
    });
    expect(await svc.sweep()).toEqual({ searches: 1, notified: 1 });
    const where = prisma.listing.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      status: 'active',
      categoryId: 'c1',
      createdAt: { gte: new Date('2026-10-20T10:00:00Z') },
      sellerId: { not: 'buyer' },
      price: { lte: 150000n },
      AND: [{ attributes: { path: ['rank'], equals: 'Gold' } }],
      seller: {
        blocksMade: { none: { blockedId: 'buyer' } },
        blocksReceived: { none: { blockerId: 'buyer' } },
      },
      searchHits: { none: { searchId: 's1' } },
    });
    expect(prisma.savedSearchHit.createMany).toHaveBeenCalledWith({
      data: [{ searchId: 's1', listingId: 'l1' }],
      skipDuplicates: true,
    });
    // Один лот — ссылка на него.
    expect(notifications.notify).toHaveBeenCalledWith('buyer', 'saved_search', {
      searchId: 's1',
      count: 1,
      preview: '«Аккаунт Gold» — 1 200 ₽',
      listingId: 'l1',
      path: '/igra/cs2/accounts?f_rank=Gold&max=1500',
    });
  });

  it('несколько лотов — одно уведомление «и ещё N» по-английски; уже вставленные — молчит', async () => {
    const { svc, prisma, notifications } = setup({
      existing: [saved({ user: { locale: 'en' } })],
      listings: [
        [
          { id: 'l1', title: 'Gold', price: 120000n },
          { id: 'l2', title: 'Gold 2', price: 130000n },
          { id: 'l3', title: 'Gold 3', price: 140000n },
        ],
        [{ id: 'l4', title: 'Gold 4', price: 100000n }],
      ],
    });
    await svc.sweep();
    expect(notifications.notify).toHaveBeenCalledWith(
      'buyer',
      'saved_search',
      expect.objectContaining({ count: 3, preview: '“Gold” — 1,200 ₽ and 2 more' }),
    );
    expect(notifications.notify.mock.calls[0]![2]).not.toHaveProperty('listingId');
    // Второй экземпляр API уже отметил лот — повторного уведомления нет.
    prisma.savedSearchHit.createMany.mockResolvedValueOnce({ count: 0 });
    await svc.sweep();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('сбой одного поиска не мешает остальным', async () => {
    const { svc, prisma, notifications } = setup({
      existing: [saved(), saved({ id: 's2', userId: 'b2' })],
    });
    prisma.listing.findMany
      .mockRejectedValueOnce(new Error('база недоступна'))
      .mockResolvedValueOnce([{ id: 'l9', title: 'Gold', price: 1000n }]);
    expect(await svc.sweep()).toEqual({ searches: 2, notified: 1 });
    expect(notifications.notify).toHaveBeenCalledWith('b2', 'saved_search', expect.anything());
  });
});
