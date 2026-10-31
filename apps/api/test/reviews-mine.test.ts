import { describe, expect, it, vi } from 'vitest';
import { ReviewsService } from '../src/modules/reviews/reviews.service';

/**
 * «Отзывы» в кабинете: полученные — о человеке как о продавце, с фильтром
 * «без ответа»; оставленные — его отзывы о продавцах, со сроком правки.
 * Чужие не видны, другая сторона — по нику.
 */

type Row = {
  id: string;
  authorId: string;
  targetId: string;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  repliedAt: Date | null;
  createdAt: Date;
  editedAt: Date | null;
  images: string[];
  order: {
    id: string;
    publicNumber: string;
    amount: bigint;
    currency: string;
    listingSnapshot: { title: string };
  };
};
type Where = Record<string, unknown>;

const DAY = 86_400_000;
const fits = (r: Row, where: Where) =>
  Object.entries(where).every(([k, v]) => (r[k as keyof Row] ?? null) === v);

function setup() {
  const rows: Row[] = [];
  let n = 0;
  const add = (authorId: string, targetId: string, extra: Partial<Row> = {}) => {
    n += 1;
    rows.push({
      id: `r${n}`,
      authorId,
      targetId,
      rating: 5,
      comment: `Отзыв ${n}`,
      sellerReply: null,
      repliedAt: null,
      createdAt: new Date(Date.now() - (20 - n) * DAY),
      editedAt: null,
      images: [],
      order: {
        id: `o${n}`,
        publicNumber: `GM-${n}`,
        amount: 50000n,
        currency: 'RUB',
        listingSnapshot: { title: `Лот ${n}` },
      },
      ...extra,
    });
  };
  const prisma = {
    review: {
      findMany: vi.fn(async ({ where, skip, take }: { where: Where; skip: number; take: number }) =>
        rows
          .filter((r) => fits(r, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(skip, skip + take),
      ),
      count: vi.fn(
        async ({ where }: { where: Where }) => rows.filter((r) => fits(r, where)).length,
      ),
    },
    profile: {
      findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in.map((userId) => ({ userId, username: `nick_${userId}` })),
      ),
    },
  };
  const svc = new ReviewsService(prisma as never, {} as never, {} as never);
  return { svc, add };
}

describe('мои отзывы', () => {
  it('полученные — новые сверху, с ником покупателя; «без ответа» — только они; чужих нет', async () => {
    const { svc, add } = setup();
    add('b1', 'me', { sellerReply: 'Спасибо', repliedAt: new Date() }); // r1
    add('b2', 'me'); // r2
    add('me', 's1'); // r3 — оставленный мной
    add('b3', 'other'); // r4 — чужой
    add('b4', 'me', { rating: 2 }); // r5

    const all = await svc.mine('me', { tab: 'received' });
    expect(all.items.map((r) => r.id)).toEqual(['r5', 'r2', 'r1']);
    expect(all.items[0]).toMatchObject({
      counterpart: 'nick_b4',
      rating: 2,
      order: { publicNumber: 'GM-5', title: 'Лот 5' },
    });
    expect(all.items[0]).not.toHaveProperty('editable');
    expect(all.counts).toEqual({ received: 3, unanswered: 2, written: 1 });

    const open = await svc.mine('me', { tab: 'received', unanswered: true });
    expect(open.items.map((r) => r.id)).toEqual(['r5', 'r2']);
  });

  it('оставленные — с ником продавца и сроком правки; по страницам', async () => {
    const { svc, add } = setup();
    add('me', 's1', { createdAt: new Date(Date.now() - 20 * DAY) }); // r1 — правка уже закрыта
    add('me', 's2', { createdAt: new Date(Date.now() - 2 * DAY) }); // r2
    add('me', 's3', { createdAt: new Date(Date.now() - DAY) }); // r3

    const first = await svc.mine('me', { tab: 'written', limit: 2 });
    expect(first.items.map((r) => [r.id, r.counterpart, r.editable])).toEqual([
      ['r3', 'nick_s3', true],
      ['r2', 'nick_s2', true],
    ]);
    expect(first.more).toBe(true);
    const second = await svc.mine('me', { tab: 'written', limit: 2, page: 2 });
    expect(second.items.map((r) => [r.id, r.editable])).toEqual([['r1', false]]);
    expect(second.more).toBe(false);
  });
});
