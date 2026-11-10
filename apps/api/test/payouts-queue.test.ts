import { describe, expect, it, vi } from 'vitest';
import { PayoutsService } from '../src/modules/payouts/payouts.service';

/**
 * Очередь выплат в консоли финансов. Раньше отдавались все заявки статуса
 * разом и без продавца — сотрудник одобрял вывод, не видя, чей он, а
 * выплаченных и отклонённых не было. Теперь — продавец и кто решал,
 * страницы, решённые по времени решения, поиск и счётчики.
 */

const at = (h: number) => new Date(Date.UTC(2026, 10, 9, h));
const row = (id: string, h: number, extra: Record<string, unknown> = {}) => ({
  id,
  userId: 's1',
  amount: 100000n,
  currency: 'RUB',
  method: 'card',
  status: 'requested',
  holdUntil: null,
  createdAt: at(h),
  updatedAt: at(h),
  externalId: null,
  failureReason: null,
  rejectReason: null,
  approvedBy: null,
  destinationEnc: 'enc',
  user: { email: 'seller@e.x', profile: { username: 'seller' } },
  ...extra,
});

function setup(rows: ReturnType<typeof row>[]) {
  const prisma = {
    payout: {
      findMany: vi.fn(async ({ take }: { take: number }) => rows.slice(0, take)),
      groupBy: vi.fn(async () => [
        { status: 'requested', _count: { _all: 120 } },
        { status: 'paid', _count: { _all: 363 } },
      ]),
    },
    profile: { findMany: vi.fn(async () => [{ userId: 'fin1', username: 'finance' }]) },
  };
  const encryption = { decrypt: () => JSON.stringify({ last4: '1111' }) };
  const none = {} as never;
  const svc = new PayoutsService(prisma as never, none, encryption as never, none, none, none);
  return { svc, prisma };
}

describe('очередь выплат', () => {
  it('ждущие — от старых, с продавцом и маской реквизитов; next — с последней; счётчики', async () => {
    const { svc, prisma } = setup([row('p1', 1), row('p2', 2), row('p3', 3)]);
    const res = await svc.queue({ limit: 2 });
    expect(res.items.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(res.items[0]).toMatchObject({
      seller: { id: 's1', username: 'seller', email: 'seller@e.x' },
      destinationHint: '•••• 1111',
      decidedBy: null,
    });
    expect(res.next).toBe(`${at(2).toISOString()}_p2`);
    expect(res.counts).toEqual({
      requested: 120,
      approved: 0,
      processing: 0,
      paid: 363,
      rejected: 0,
    });
    expect(prisma.payout.findMany.mock.calls[0]![0]).toMatchObject({
      where: { status: 'requested' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 3,
    });
  });

  it('выплаченные — свежие решения сверху, с тем, кто решал; курсор — по времени решения', async () => {
    const { svc, prisma } = setup([
      row('p9', 1, { status: 'paid', approvedBy: 'fin1', updatedAt: at(9) }),
    ]);
    const res = await svc.queue({ status: 'paid', cursor: { at: at(10), id: 'p10' } });
    expect(res.items[0]).toMatchObject({ decidedBy: 'finance', updatedAt: at(9) });
    expect(prisma.payout.findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        status: 'paid',
        AND: [
          {},
          { OR: [{ updatedAt: { lt: at(10) } }, { updatedAt: at(10), id: { lt: 'p10' } }] },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('поиск — ник, почта и номер у шлюза; «@» впереди не мешает; счётчики — по найденному', async () => {
    const { svc, prisma } = setup([]);
    await svc.queue({ q: '@sell_er' });
    const m = { contains: 'sell\\_er', mode: 'insensitive' };
    const where = {
      OR: [{ user: { email: m } }, { user: { profile: { username: m } } }, { externalId: m }],
    };
    expect(prisma.payout.findMany.mock.calls[0]![0]).toMatchObject({ where: { AND: [where, {}] } });
    expect(prisma.payout.groupBy.mock.calls[0]![0]).toMatchObject({ where });
  });
});
