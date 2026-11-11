import { describe, expect, it, vi } from 'vitest';
import { ModerationService } from '../src/modules/moderation/moderation.service';

/**
 * Консоль → «Пользователи» и «Лоты». Раньше — 50 последних без продолжения
 * и без счётчиков, а за что заблокирован лот или пользователь, в консоли не
 * было. Теперь — страницы, счётчики по статусам (в поиске — найденных),
 * поиск по нику, почте, названию и id, лоты одного продавца и последнее
 * решение модератора.
 *
 * Prisma подменена: проверяются запросы и сборка ответа, а не драйвер базы.
 */

const at = (h: number) => new Date(Date.UTC(2026, 10, 10, h));
const ID = '0b6f6c1e-4a2b-4c3d-8e9f-001122334455';

const user = (id: string, h: number, extra: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@e.x`,
  status: 'active',
  createdAt: at(h),
  profile: { username: id, salesCount: 0, ratingAvg: 0, ratingCount: 0, onlineAt: null },
  roles: [] as Array<{ role: { key: string } }>,
  ...extra,
});

const lot = (id: string, h: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Лот ${id}`,
  status: 'active',
  price: 10000n,
  currency: 'RUB',
  stock: null,
  createdAt: at(h),
  game: { title: 'CS2' },
  category: { title: 'Аккаунты' },
  seller: { id: 's1', status: 'active', profile: { username: 'seller' } },
  ...extra,
});

function setup(opts: {
  users?: ReturnType<typeof user>[];
  lots?: ReturnType<typeof lot>[];
  named?: number;
  actions?: Array<Record<string, unknown>>;
} = {}) {
  const prisma = {
    user: {
      findMany: vi.fn(async ({ take }: { take: number }) => (opts.users ?? []).slice(0, take)),
      groupBy: vi.fn(async () => [
        { status: 'active', _count: { _all: 900 } },
        { status: 'frozen', _count: { _all: 7 } },
        { status: 'banned', _count: { _all: 3 } },
      ]),
      count: vi.fn(async () => 4),
    },
    // Риск-балл за 30 дней (часть 128): сигналов в этих тестах нет.
    riskSignal: { groupBy: vi.fn(async () => []) },
    listing: {
      findMany: vi.fn(async ({ take }: { take: number }) => (opts.lots ?? []).slice(0, take)),
      groupBy: vi.fn(async ({ by }: { by: string[] }) =>
        by[0] === 'status'
          ? [
              { status: 'active', _count: { _all: 120 } },
              { status: 'paused', _count: { _all: 5 } },
              { status: 'draft', _count: { _all: 2 } },
              { status: 'blocked', _count: { _all: 9 } },
              { status: 'archived', _count: { _all: 40 } },
            ]
          : [{ sellerId: 'u1', _count: { _all: 12 } }],
      ),
    },
    profile: {
      findMany: vi.fn(async ({ where }: { where: { username?: unknown } }) =>
        where.username
          ? Array.from({ length: opts.named ?? 1 }, (_, i) => ({ userId: `p${i}` }))
          : [{ userId: 'mod1', username: 'moderator' }],
      ),
      findUnique: vi.fn(async () => ({ username: 'seller' })),
    },
    moderationAction: { findMany: vi.fn(async () => opts.actions ?? []) },
  };
  const none = {} as never;
  return { svc: new ModerationService(prisma as never, none, none, none), prisma };
}

describe('консоль: пользователи', () => {
  it('новые сверху, по страницам; счётчики по статусам и сотрудникам; лоты в продаже', async () => {
    const { svc, prisma } = setup({ users: [user('u1', 3), user('u2', 2), user('u3', 1)] });
    const res = await svc.listUsers({ limit: 2 });
    expect(res.items.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(res.next).toBe(`${at(2).toISOString()}_u2`);
    expect(res.counts).toEqual({ all: 910, active: 900, frozen: 7, banned: 3, staff: 4 });
    expect(res.items[0]).toMatchObject({ activeListings: 12, roles: [], restriction: null });
    expect(res.items[1]!.activeListings).toBe(0);
    expect(prisma.user.findMany.mock.calls[0]![0]).toMatchObject({
      where: { AND: [{}, {}, {}] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
    // У активных решений модератора не ищем.
    expect(prisma.moderationAction.findMany).not.toHaveBeenCalled();
  });

  it('следующая страница — с границей по индексу; «Сотрудники» — по ролям', async () => {
    const { svc, prisma } = setup();
    await svc.listUsers({ status: 'staff', cursor: { at: at(5), id: 'u9' } });
    const where = prisma.user.findMany.mock.calls[0]![0].where as { AND: unknown[] };
    expect(where.AND[1]).toEqual({
      roles: { some: { role: { key: { in: ['agent', 'moderator', 'finance', 'admin'] } } } },
    });
    expect(where.AND[2]).toEqual({
      createdAt: { lte: at(5) },
      OR: [{ createdAt: { lt: at(5) } }, { id: { lt: 'u9' } }],
    });
  });

  it('у замороженного и забаненного — когда, кто и за что; снятое ограничение не показывается', async () => {
    const { svc, prisma } = setup({
      users: [
        user('u1', 3, { status: 'frozen' }),
        user('u2', 2, { status: 'banned' }),
        user('u3', 1, { status: 'banned' }),
      ],
      actions: [
        { targetId: 'u1', action: 'block', actorId: 'mod1', reason: 'Спам', createdAt: at(9) },
        { targetId: 'u2', action: 'ban', actorId: 'mod1', reason: 'Мошенничество', createdAt: at(8) },
        { targetId: 'u2', action: 'block', actorId: 'mod1', reason: 'старое', createdAt: at(7) },
        // Последнее по u3 — заморозка, а он забанен не модератором: подписи нет.
        { targetId: 'u3', action: 'block', actorId: 'mod1', reason: 'не то', createdAt: at(6) },
      ],
    });
    const res = await svc.listUsers();
    expect(res.items.map((u) => u.restriction)).toEqual([
      { at: at(9), by: 'moderator', reason: 'Спам' },
      { at: at(8), by: 'moderator', reason: 'Мошенничество' },
      null,
    ]);
    expect(prisma.moderationAction.findMany.mock.calls[0]![0]).toMatchObject({
      where: { targetType: 'user', targetId: { in: ['u1', 'u2', 'u3'] }, action: { in: ['block', 'ban', 'unblock'] } },
    });
  });

  it('поиск — почта, ник списком найденных, id; «@» впереди не мешает; счётчики — по найденному', async () => {
    const { svc, prisma } = setup();
    await svc.listUsers({ q: `@${ID.toUpperCase()}` });
    const m = { contains: ID.toUpperCase(), mode: 'insensitive' };
    const match = { OR: [{ id: ID }, { email: m }, { id: { in: ['p0'] } }] };
    expect(prisma.user.findMany.mock.calls[0]![0].where.AND[0]).toEqual(match);
    expect(prisma.user.groupBy.mock.calls[0]![0]).toMatchObject({ where: match });
    expect(prisma.user.count.mock.calls[0]![0].where.AND[0]).toEqual(match);
  });

  it('ник нашёлся у тысяч — условием по профилю, а не тысячами id', async () => {
    const { svc, prisma } = setup({ named: 201 });
    await svc.listUsers({ q: 'e2e' });
    const m = { contains: 'e2e', mode: 'insensitive' };
    expect(prisma.user.findMany.mock.calls[0]![0].where.AND[0]).toEqual({
      OR: [{ email: m }, { profile: { username: m } }],
    });
  });
});

describe('консоль: лоты', () => {
  it('без фильтра — всё, кроме архива; «Сняты» — со снятыми черновиками; счётчики', async () => {
    const { svc, prisma } = setup({ lots: [lot('l1', 3), lot('l2', 2), lot('l3', 1)] });
    const res = await svc.listListings({ limit: 2 });
    expect(res.items.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(res.next).toBe(`${at(2).toISOString()}_l2`);
    expect(res.counts).toEqual({ all: 136, active: 120, paused: 7, sold_out: 0, blocked: 9, archived: 40, review: 0 });
    expect(res.seller).toBeNull();
    expect(prisma.listing.findMany.mock.calls[0]![0]).toMatchObject({
      where: { AND: [{ status: { not: 'archived' } }, {}] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
    await svc.listListings({ status: 'paused' });
    expect(prisma.listing.findMany.mock.calls[1]![0].where.AND[0]).toEqual({ status: { in: ['paused', 'draft'] } });
  });

  it('у заблокированного — когда, кто и за что; разблокированный и снова заблокированный — по последнему', async () => {
    const { svc, prisma } = setup({
      lots: [lot('l1', 3, { status: 'blocked' }), lot('l2', 2, { status: 'blocked' }), lot('l3', 1)],
      actions: [
        { targetId: 'l1', action: 'block', actorId: 'mod1', reason: 'Просит оплату на карту', createdAt: at(9) },
        { targetId: 'l1', action: 'unblock', actorId: 'mod1', reason: null, createdAt: at(8) },
        { targetId: 'l2', action: 'unblock', actorId: 'mod1', reason: null, createdAt: at(7) },
      ],
    });
    const res = await svc.listListings();
    expect(res.items.map((l) => l.block)).toEqual([
      { at: at(9), by: 'moderator', reason: 'Просит оплату на карту' },
      null,
      null,
    ]);
    expect(prisma.moderationAction.findMany.mock.calls[0]![0]).toMatchObject({
      where: { targetType: 'listing', targetId: { in: ['l1', 'l2'] }, action: { in: ['block', 'unblock'] } },
    });
  });

  it('лоты одного продавца — с его ником; поиск — название, продавец, id; счётчики — по найденному', async () => {
    const { svc, prisma } = setup();
    const res = await svc.listListings({ seller: 's1', q: '#ak_47' });
    expect(res.seller).toEqual({ id: 's1', username: 'seller' });
    const m = { contains: 'ak\\_47', mode: 'insensitive' };
    const scope = [{ sellerId: 's1' }, { OR: [{ title: m }, { sellerId: { in: ['p0'] } }] }];
    expect(prisma.listing.findMany.mock.calls[0]![0].where.AND.slice(0, 2)).toEqual(scope);
    expect(prisma.listing.groupBy.mock.calls[0]![0]).toMatchObject({ by: ['status'], where: { AND: scope } });
  });
});
