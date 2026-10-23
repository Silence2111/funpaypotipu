import { describe, expect, it, vi } from 'vitest';
import { FEED_LIMIT, FollowsService, MAX_FOLLOWS } from '../src/modules/follows/follows.service';

/**
 * Подписки на продавцов. Проверяется: на себя и на несуществующего — отказ,
 * повтор — без второй записи, не больше предела; проход: каждому подписчику —
 * новое после его отметки, новый лот со скидкой — одно уведомление о новом,
 * чёрный список молчит, отметка сдвигается до уведомления и только с
 * прежней, без нового — тоже сдвигается, но не назад.
 */

type Row = Record<string, unknown>;

const t = (s: number) => new Date(Date.UTC(2026, 9, 21, 10, 0, s));

function setup(
  opts: {
    follows?: Row[];
    fresh?: Row[];
    sales?: Row[];
    blocks?: Row[];
    existing?: Row | null;
    count?: number;
    seller?: Row | null;
    moved?: number;
  } = {},
) {
  const prisma = {
    sellerFollow: {
      findMany: vi.fn(async () => opts.follows ?? []),
      findUnique: vi.fn(async () => opts.existing ?? null),
      count: vi.fn(async () => opts.count ?? 0),
      createMany: vi.fn(async () => ({ count: 1 })),
      updateMany: vi.fn(async ({ where }: { where: Row }) => ({
        count: 'since' in where && where.since instanceof Date ? (opts.moved ?? 1) : 1,
      })),
    },
    listing: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        'saleStartedAt' in where ? (opts.sales ?? []) : (opts.fresh ?? []),
      ),
    },
    profile: {
      findUnique: vi.fn(async () =>
        opts.seller === undefined
          ? { username: 'seller1', user: { status: 'active' } }
          : opts.seller,
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    userBlock: { findMany: vi.fn(async () => opts.blocks ?? []) },
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const listings = { followFeed: vi.fn(async () => ({ items: [], total: 0 })) };
  return {
    svc: new FollowsService(prisma as never, notifications as never, listings as never),
    prisma,
    notifications,
    listings,
  };
}

const follow = (id: string, userId: string, since: Date): Row => ({
  id,
  userId,
  sellerId: 's1',
  since,
  user: { locale: 'ru' },
});
const lot = (id: string, createdAt: Date, over: Row = {}): Row => ({
  id,
  title: `Лот ${id}`,
  price: 90000n,
  saleListPrice: null,
  createdAt,
  saleStartedAt: null,
  ...over,
});

describe('подписка', () => {
  it('на себя и на несуществующего — отказ; повтор — без второй записи; не больше предела', async () => {
    await expect(setup().svc.follow('u1', 'u1')).rejects.toThrow('На себя подписаться нельзя');
    await expect(setup({ seller: null }).svc.follow('u1', 's1')).rejects.toThrow(
      'Продавец не найден',
    );
    const again = setup({ existing: { notify: false } });
    expect(await again.svc.follow('u1', 's1')).toMatchObject({ following: true, notify: false });
    expect(again.prisma.sellerFollow.createMany).not.toHaveBeenCalled();
    await expect(setup({ count: MAX_FOLLOWS }).svc.follow('u1', 's1')).rejects.toThrow(/Не больше/);
    const fresh = setup();
    expect(await fresh.svc.follow('u1', 's1')).toMatchObject({ following: true, notify: true });
    expect(fresh.prisma.sellerFollow.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', sellerId: 's1' }],
      skipDuplicates: true,
    });
  });
});

describe('проход по подпискам', () => {
  it('каждому — новое после его отметки; новый лот со скидкой — одно уведомление', async () => {
    const { svc, notifications, prisma } = setup({
      follows: [follow('f1', 'u1', t(0)), follow('f2', 'u2', t(20))],
      fresh: [lot('l2', t(30)), lot('l1', t(10))],
      sales: [
        lot('l2', t(30), { saleStartedAt: t(30), saleListPrice: 100000n }),
        lot('l0', t(-100), { saleStartedAt: t(15), saleListPrice: 100000n }),
      ],
    });
    expect(await svc.sweep()).toEqual({ sellers: 1, notified: 2 });
    // Один запрос лотов на продавца — от самой ранней отметки.
    expect(prisma.listing.findMany.mock.calls[0]![0].where).toMatchObject({
      sellerId: 's1',
      createdAt: { gt: t(0) },
    });
    const sent = notifications.notify.mock.calls.map((c) => [
      c[0],
      c[1],
      String((c[2] as Row).preview).replace(/\s/g, ' '),
    ]);
    expect(sent).toEqual([
      ['u1', 'seller_new_lots', 'seller1: «Лот l2» — 900 ₽ и ещё 1'],
      ['u1', 'seller_sale', 'seller1: «Лот l0» — 900 ₽ вместо 1 000 ₽'],
      ['u2', 'seller_new_lots', 'seller1: «Лот l2» — 900 ₽'],
    ]);
    // Один лот — ссылка на него; скидка l0 у u2 — до его отметки, не пришла.
    expect(notifications.notify.mock.calls[2]![2]).toMatchObject({
      listingId: 'l2',
      sellerId: 's1',
    });
    expect(notifications.notify.mock.calls[0]![2]).not.toHaveProperty('listingId');
  });

  it('чёрный список молчит; отметка сдвигается и без нового, но не назад', async () => {
    const { svc, notifications, prisma } = setup({
      follows: [follow('f1', 'u1', t(0)), follow('f2', 'u2', t(0))],
      fresh: [lot('l1', t(10))],
      blocks: [{ blockerId: 's1', blockedId: 'u1' }],
    });
    await svc.sweep();
    expect(notifications.notify.mock.calls.map((c) => c[0])).toEqual(['u2']);
    const quiet = prisma.sellerFollow.updateMany.mock.calls.find(
      (c) => (c[0].where as Row).id && typeof (c[0].where as Row).id === 'object',
    );
    expect(quiet![0].where).toMatchObject({ id: { in: ['f1'] }, since: { lt: expect.any(Date) } });
  });

  it('отметку уже сдвинул другой экземпляр API — молчит', async () => {
    const { svc, notifications } = setup({
      follows: [follow('f1', 'u1', t(0))],
      fresh: [lot('l1', t(10))],
      moved: 0,
    });
    expect(await svc.sweep()).toEqual({ sellers: 1, notified: 0 });
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('лента подписок', () => {
  it('первая страница новых отмечает визит и считает новое с прошлого; скидки и дальние страницы — нет', async () => {
    const { svc, prisma, listings } = setup({ seller: { followFeedSeenAt: t(0) } });
    await svc.feed('u1', 'new', 1);
    expect(listings.followFeed).toHaveBeenLastCalledWith('u1', {
      sale: false,
      page: 1,
      limit: FEED_LIMIT,
      freshSince: t(0),
    });
    expect(prisma.profile.updateMany).toHaveBeenCalledTimes(1);
    await svc.feed('u1', 'sale', 1);
    await svc.feed('u1', 'new', 2);
    expect(prisma.profile.updateMany).toHaveBeenCalledTimes(1);
    expect(listings.followFeed).toHaveBeenLastCalledWith('u1', {
      sale: false,
      page: 2,
      limit: FEED_LIMIT,
      freshSince: null,
    });
  });
});
