import { describe, expect, it, vi } from 'vitest';
import { RecoveryService } from '../src/modules/recovery/recovery.service';

/**
 * Очередь «Восстановление» в консоли. Раньше отдавались 100 заявок: ждущие
 * — от старых, и при очереди больше сотни новая заявка в список не
 * попадала; решённую старше сотой было не найти. Теперь — страницы,
 * решённые по времени решения, счётчики и поиск.
 */

const at = (h: number) => new Date(Date.UTC(2026, 10, 4, h));
const row = (id: string, h: number, extra: Record<string, unknown> = {}) => ({
  id,
  userId: 'u1',
  createdAt: at(h),
  decidedAt: null,
  status: 'pending',
  reason: 'password',
  orderNumbers: [],
  objectedAt: null,
  contactEmail: null,
  user: { email: 'owner@e.x', profile: { username: 'owner' } },
  ...extra,
});

function setup(rows: ReturnType<typeof row>[]) {
  const prisma = {
    accountRecovery: {
      findMany: vi.fn(async ({ take }: { take: number }) => rows.slice(0, take)),
      groupBy: vi.fn(async () => [
        { status: 'pending', _count: { _all: 185 } },
        { status: 'restored', _count: { _all: 432 } },
      ]),
    },
    order: { findMany: vi.fn(async () => []) },
  };
  const none = {} as never;
  const svc = new RecoveryService(prisma as never, none, none, none, none, none, none, none, none);
  return { svc, prisma };
}

describe('очередь восстановления', () => {
  it('ждущие — от старых к новым, по страницам; next — с последней показанной; счётчики по статусам', async () => {
    const { svc, prisma } = setup([row('r1', 1), row('r2', 2), row('r3', 3)]);
    const res = await svc.queue({ limit: 2 });
    expect(res.items.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(res.items[0]).toMatchObject({ email: 'owner@e.x', username: 'owner' });
    expect(res.next).toBe(`${at(2).toISOString()}_r2`);
    expect(res.counts).toEqual({ pending: 185, restored: 432, rejected: 0 });
    expect(prisma.accountRecovery.findMany.mock.calls[0]![0]).toMatchObject({
      where: { status: 'pending' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 3,
    });
  });

  it('решённые — свежие решения сверху, курсор — по времени решения', async () => {
    const { svc, prisma } = setup([row('r9', 1, { status: 'restored', decidedAt: at(9) })]);
    await svc.queue({ status: 'restored', cursor: { at: at(10), id: 'r10' } });
    expect(prisma.accountRecovery.findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        status: 'restored',
        AND: [
          {},
          { OR: [{ decidedAt: { lt: at(10) } }, { decidedAt: at(10), id: { lt: 'r10' } }] },
        ],
      },
      orderBy: [{ decidedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    });
  });

  it('поиск — ник, почта аккаунта и новая почта из заявки; «@» впереди не мешает; счётчики — по найденному', async () => {
    const { svc, prisma } = setup([]);
    await svc.queue({ q: ' @owner_1 ' });
    const match = { contains: 'owner\\_1', mode: 'insensitive' };
    const where = {
      OR: [
        { user: { email: match } },
        { user: { profile: { username: match } } },
        { contactEmail: match },
      ],
    };
    expect(prisma.accountRecovery.findMany.mock.calls[0]![0]).toMatchObject({
      where: { AND: [where, {}] },
    });
    expect(prisma.accountRecovery.groupBy.mock.calls[0]![0]).toMatchObject({ where });
  });
});
