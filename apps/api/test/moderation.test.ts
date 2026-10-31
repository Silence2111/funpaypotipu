import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModerationService } from '../src/modules/moderation/moderation.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { AccountStatusService } from '../src/modules/access/account-status.service';

/**
 * Модерация. Раньше бан менял одну строку в базе: забаненный входил, его
 * токены работали, лоты висели в каталоге. Жалоба принимала любой id.
 * Проверяется, что решение модератора действует, а модератор не может
 * снять сотрудника.
 *
 * Prisma подменена: проверяются правила, а не драйвер базы.
 */

const USER = { id: 'u-bad', status: 'active', roles: [] as Array<{ role: { key: string } }> };

function setup(opts: { target?: Record<string, unknown>; staffIsAdmin?: boolean; reports?: Record<string, unknown>[] } = {}) {
  const calls = { listingUpdateMany: [] as unknown[], sessions: [] as unknown[], reportUpdateMany: [] as unknown[] };
  const state = { user: { ...USER, ...(opts.target ?? {}) }, reports: [...(opts.reports ?? [])] };
  const prisma = {
    user: {
      findUnique: vi.fn(async () => state.user),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.user, data)),
    },
    userRole: { count: vi.fn(async () => (opts.staffIsAdmin ? 1 : 0)) },
    listing: {
      findUnique: vi.fn(async () => ({ id: 'l1', sellerId: 'u-bad', title: 'Аккаунт', status: 'active', stock: null })),
      findMany: vi.fn(async () => [{ id: 'l1' }, { id: 'l2' }]),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'l1', ...data })),
      updateMany: vi.fn(async (a: unknown) => {
        calls.listingUpdateMany.push(a);
        return { count: 2 };
      }),
    },
    message: { findUnique: vi.fn(async () => null) },
    authSession: {
      updateMany: vi.fn(async (a: unknown) => {
        calls.sessions.push(a);
        return { count: 1 };
      }),
    },
    report: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => state.reports[0] ?? null),
      findMany: vi.fn(async () => state.reports.map((r) => ({ id: r.id, reporterId: r.reporterId }))),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r-new', ...data })),
      updateMany: vi.fn(async (a: unknown) => {
        calls.reportUpdateMany.push(a);
        return { count: state.reports.length };
      }),
    },
    moderationAction: { create: vi.fn(async () => ({})) },
    auditLog: { findFirst: vi.fn(async () => null) },
  };
  const audit = { log: vi.fn(async () => ({})) };
  const notifications = { notify: vi.fn(async () => undefined) };
  const svc = new ModerationService(prisma as never, audit as never, notifications as never);
  return { svc, prisma, calls, state, notifications };
}

beforeEach(() => vi.clearAllMocks());

describe('бан и заморозка', () => {
  it('бан отзывает сессии и снимает лоты из каталога', async () => {
    const { svc, state, calls } = setup();
    await svc.setUserStatus('mod', 'u-bad', 'banned', 'мошенничество');
    expect(state.user.status).toBe('banned');
    expect(calls.sessions).toHaveLength(1);
    expect(calls.listingUpdateMany[0]).toMatchObject({ data: { status: 'paused' } });
  });

  it('заморозка снимает лоты, но сессии не трогает: довести сделки можно', async () => {
    const { svc, calls } = setup();
    await svc.setUserStatus('mod', 'u-bad', 'frozen');
    expect(calls.sessions).toHaveLength(0);
    expect(calls.listingUpdateMany).toHaveLength(1);
  });

  it('модератор не блокирует сотрудника — только администратор', async () => {
    const staff = { roles: [{ role: { key: 'agent' } }] };
    await expect(setup({ target: staff }).svc.setUserStatus('mod', 'u-bad', 'banned')).rejects.toThrow(/администратор/);
    await expect(setup({ target: staff, staffIsAdmin: true }).svc.setUserStatus('admin', 'u-bad', 'banned')).resolves.toMatchObject({
      status: 'banned',
    });
  });

  it('себя не банят', async () => {
    await expect(setup().svc.setUserStatus('u-bad', 'u-bad', 'banned')).rejects.toThrow(/Свой аккаунт/);
  });

  it('разблокировка возвращает лоты, которые сняла блокировка', async () => {
    const { svc, prisma, calls } = setup({ target: { status: 'banned' } });
    prisma.auditLog.findFirst.mockResolvedValueOnce({ after: { pausedListings: ['l1', 'l2'] } } as never);
    await svc.setUserStatus('mod', 'u-bad', 'active');
    expect(calls.listingUpdateMany[0]).toMatchObject({ where: { id: { in: ['l1', 'l2'] }, status: 'paused' }, data: { status: 'active' } });
  });
});

describe('жалобы', () => {
  it('на свой лот и на себя жалоба не принимается', async () => {
    const { svc } = setup();
    await expect(svc.createReport('u-bad', 'listing', 'l1', 'Мошенничество')).rejects.toThrow(/свой лот/);
    await expect(setup({ target: { id: 'me' } }).svc.createReport('me', 'user', 'me', 'Оскорбления')).rejects.toThrow(/себя/);
  });

  it('жалоба на чужое сообщение — только от участника диалога', async () => {
    const { svc } = setup();
    await expect(svc.createReport('stranger', 'message', 'm1', 'Оскорбления')).rejects.toThrow(/не найдено/);
  });

  it('решение с действием: лот заблокирован, все жалобы на него закрыты, пожаловавшиеся узнают', async () => {
    const reports = [
      { id: 'r1', reporterId: 'a', targetType: 'listing', targetId: 'l1', reason: 'Мошенничество' },
      { id: 'r2', reporterId: 'b', targetType: 'listing', targetId: 'l1', reason: 'Мошенничество' },
    ];
    const { svc, prisma, calls, notifications } = setup({ reports });
    await svc.handleReport('r1', 'mod', { status: 'resolved', action: 'block_listing' });
    expect(prisma.listing.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'blocked' } }));
    expect(calls.reportUpdateMany[0]).toMatchObject({ where: { id: { in: ['r1', 'r2'] } }, data: { status: 'resolved' } });
    // время решения — по нему «Решённые» идут свежими сверху
    expect((calls.reportUpdateMany[0] as { data: { handledAt?: unknown } }).data.handledAt).toBeInstanceOf(Date);
    expect(notifications.notify).toHaveBeenCalledWith('a', 'report_handled', { status: 'resolved' });
    expect(notifications.notify).toHaveBeenCalledWith('b', 'report_handled', { status: 'resolved' });
    expect(notifications.notify).toHaveBeenCalledWith('u-bad', 'listing_blocked', expect.objectContaining({ listingId: 'l1' }));
  });

  it('«взял в работу» — ещё не решение: времени решения нет', async () => {
    const { svc, calls } = setup({ reports: [{ id: 'r1', reporterId: 'a', targetType: 'listing', targetId: 'l1', reason: 'x' }] });
    await svc.handleReport('r1', 'mod', { status: 'reviewing' });
    expect(calls.reportUpdateMany[0]).toMatchObject({ data: { status: 'reviewing' } });
    expect((calls.reportUpdateMany[0] as { data: Record<string, unknown> }).data).not.toHaveProperty('handledAt');
  });

  it('отклонить жалобу с действием нельзя — действие только при решении', async () => {
    const { svc } = setup({ reports: [{ id: 'r1', reporterId: 'a', targetType: 'listing', targetId: 'l1', reason: 'x' }] });
    await expect(svc.handleReport('r1', 'mod', { status: 'rejected', action: 'ban_user' })).rejects.toThrow(/только вместе/);
  });
});

describe('бан действует сразу', () => {
  const ctx = (token: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }),
    }) as never;
  const tokens = { verifyAccess: () => ({ sub: 'u-bad', username: 'bad' }) };

  it('выданный до бана токен больше не работает', async () => {
    const prisma = { user: { findUnique: vi.fn(async () => ({ status: 'banned' })) } };
    const guard = new JwtAuthGuard(tokens as never, prisma as never);
    await expect(guard.canActivate(ctx('t'))).rejects.toThrow(/заблокирован/);
  });

  it('замороженный входит, но не торгует', async () => {
    const prisma = { user: { findUnique: vi.fn(async () => ({ status: 'frozen' })) } };
    const guard = new JwtAuthGuard(tokens as never, prisma as never);
    await expect(guard.canActivate(ctx('t'))).resolves.toBe(true);
    await expect(new AccountStatusService(prisma as never).assertCanTrade('u-bad')).rejects.toThrow(/заморожен/);
  });
});

describe('очередь жалоб', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 31, h));
  const report = (id: string, h: number, extra: Record<string, unknown> = {}) => ({
    id, reporterId: 'a', targetType: 'user', targetId: `u-${id}`, reason: 'Спам', details: null,
    status: 'open', handledBy: null, handledAt: null, createdAt: at(h), ...extra,
  });

  function queueSetup(rows: ReturnType<typeof report>[], open = 0) {
    const prisma = {
      report: {
        findMany: vi.fn(async ({ take }: { take: number }) => rows.slice(0, take)),
        groupBy: vi.fn(async () => []),
        count: vi.fn(async () => open),
      },
      listing: { findMany: vi.fn(async () => []) },
      user: { findMany: vi.fn(async () => []) },
      message: { findMany: vi.fn(async () => []) },
    };
    const svc = new ModerationService(prisma as never, {} as never, {} as never);
    return { svc, prisma };
  }

  it('открытые — от старых к новым, по 50; next — с последней показанной; сколько ждёт — счётчиком', async () => {
    const { svc, prisma } = queueSetup([report('r1', 1), report('r2', 2), report('r3', 3)], 260);
    const res = await svc.listReports({ limit: 2 });
    expect(res.items.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(res.next).toBe(`${at(2).toISOString()}_r2`);
    expect(res.counts).toEqual({ open: 260 });
    expect(prisma.report.findMany.mock.calls[0]![0]).toMatchObject({
      where: { status: { in: ['open', 'reviewing'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 3,
    });
    // открытые жалобы на цель — только по целям этой страницы
    expect(prisma.report.groupBy.mock.calls[0]![0]).toMatchObject({ where: { targetId: { in: ['u-r1', 'u-r2'] } } });
  });

  it('следующая страница открытых — после последней показанной', async () => {
    const { svc, prisma } = queueSetup([report('r3', 3)]);
    const res = await svc.listReports({ cursor: { at: at(2), id: 'r2' } });
    expect(res.next).toBeNull();
    expect(prisma.report.findMany.mock.calls[0]![0]).toMatchObject({
      where: { OR: [{ createdAt: { gt: at(2) } }, { createdAt: at(2), id: { gt: 'r2' } }] },
    });
  });

  it('решённые — свежие решения сверху, курсор — по времени решения', async () => {
    const rows = [report('r9', 1, { status: 'resolved', handledAt: at(9) }), report('r8', 2, { status: 'resolved', handledAt: at(8) })];
    const { svc, prisma } = queueSetup(rows);
    const res = await svc.listReports({ status: 'resolved', limit: 1, cursor: { at: at(10), id: 'r10' } });
    expect(res.next).toBe(`${at(9).toISOString()}_r9`);
    expect(prisma.report.findMany.mock.calls[0]![0]).toMatchObject({
      where: { status: 'resolved', OR: [{ handledAt: { lt: at(10) } }, { handledAt: at(10), id: { lt: 'r10' } }] },
      orderBy: [{ handledAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    });
  });
});
