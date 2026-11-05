import { describe, expect, it, vi } from 'vitest';
import { KycService } from '../src/modules/kyc/kyc.service';

/**
 * Очередь «Проверка личности» в консоли. Раньше отдавались все ждущие
 * заявки разом — со ссылками на документы для каждой, — а решённых и поиска
 * не было. Теперь — страницы, решённые по времени решения с причиной и
 * сотрудником, поиск и счётчики.
 */

const at = (h: number) => new Date(Date.UTC(2026, 10, 5, h));
const row = (id: string, h: number, extra: Record<string, unknown> = {}) => ({
  id,
  userId: 'u1',
  level: 'basic',
  status: 'pending',
  reason: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: at(h),
  documentRefs: { keys: [`kyc/${id}.jpg`], selfie: `kyc/${id}-s.jpg` },
  user: {
    email: 'seller@e.x',
    createdAt: at(0),
    profile: { username: 'seller', displayName: 'Продавец', salesCount: 3 },
  },
  ...extra,
});

function setup(rows: ReturnType<typeof row>[]) {
  const prisma = {
    kycVerification: {
      findMany: vi.fn(async ({ take }: { take: number }) => rows.slice(0, take)),
      groupBy: vi.fn(async () => [
        { status: 'pending', _count: { _all: 120 } },
        { status: 'rejected', _count: { _all: 7 } },
      ]),
    },
    profile: { findMany: vi.fn(async () => [{ userId: 'mod1', username: 'moderator' }]) },
  };
  const storage = { presignGet: vi.fn(async (key: string) => `https://files/${key}`) };
  const none = {} as never;
  const svc = new KycService(prisma as never, storage as never, none, none, none);
  return { svc, prisma, storage };
}

describe('очередь проверки личности', () => {
  it('ждущие — от старых, по страницам; ссылки на документы — только этой страницы; счётчики', async () => {
    const { svc, prisma, storage } = setup([row('k1', 1), row('k2', 2), row('k3', 3)]);
    const res = await svc.queue({ limit: 2 });
    expect(res.items.map((k) => k.id)).toEqual(['k1', 'k2']);
    expect(res.items[0]).toMatchObject({ user: { username: 'seller', sales: 3 } });
    expect(res.items[0]!.files.map((f) => f.kind)).toEqual(['document', 'selfie']);
    expect(storage.presignGet).toHaveBeenCalledTimes(4); // две заявки × документ и селфи
    expect(res.next).toBe(`${at(2).toISOString()}_k2`);
    expect(res.counts).toEqual({ pending: 120, approved: 0, rejected: 7 });
    expect(prisma.kycVerification.findMany.mock.calls[0]![0]).toMatchObject({
      where: { status: 'pending' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 3,
    });
  });

  it('отклонённые — свежие решения сверху, с причиной и сотрудником; курсор — по времени решения', async () => {
    const { svc, prisma } = setup([
      row('k9', 1, {
        status: 'rejected',
        reason: 'Селфи размыто',
        reviewedBy: 'mod1',
        reviewedAt: at(9),
      }),
    ]);
    const res = await svc.queue({ status: 'rejected', cursor: { at: at(10), id: 'k10' } });
    expect(res.items[0]).toMatchObject({
      reason: 'Селфи размыто',
      reviewer: 'moderator',
      reviewedAt: at(9),
    });
    expect(prisma.kycVerification.findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        status: 'rejected',
        AND: [
          {},
          { OR: [{ reviewedAt: { lt: at(10) } }, { reviewedAt: at(10), id: { lt: 'k10' } }] },
        ],
      },
      orderBy: [{ reviewedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    });
  });

  it('поиск — ник, имя и почта; «@» впереди не мешает; счётчики — по найденному', async () => {
    const { svc, prisma } = setup([]);
    await svc.queue({ q: '@sell_er' });
    const m = { contains: 'sell\\_er', mode: 'insensitive' };
    const where = {
      OR: [
        { user: { email: m } },
        { user: { profile: { username: m } } },
        { user: { profile: { displayName: m } } },
      ],
    };
    expect(prisma.kycVerification.findMany.mock.calls[0]![0]).toMatchObject({
      where: { AND: [where, {}] },
    });
    expect(prisma.kycVerification.groupBy.mock.calls[0]![0]).toMatchObject({ where });
  });
});
