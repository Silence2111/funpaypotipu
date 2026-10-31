import { describe, it, expect } from 'vitest';
import { RankingService, DEMO_DOMAIN } from '../src/modules/ranking/ranking.service';
import { THRESHOLD_TALK } from '@gamemarket/shared';

/**
 * Замер выдачи на реальном пути API. Главное здесь — что он не считает
 * на сиде и не подглядывает в будущее: оба нарушения завышают выигрыш
 * алгоритма, а цифра потом уходит в продающие материалы.
 */

type O = {
  id: string;
  sellerId: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  email?: string;
  dispute?: { status: string } | null;
};

const stub = (orders: O[]) =>
  ({
    order: {
      findMany: async () =>
        orders.map((o) => ({
          ...o,
          listingSnapshot: { price: '1000' },
          dispute: o.dispute ?? null,
          seller: { email: o.email ?? 'real@seller.ru' },
          listing: { gameId: 'g', categoryId: 'c', price: 1000n, createdAt: new Date(0) },
        })),
    },
    review: { findMany: async () => [] },
  }) as never;

const d = (day: number) => new Date(Date.UTC(2026, 0, day));

describe('замер выдачи через API', () => {
  it('на пустой базе честно отказывается', async () => {
    const r = await new RankingService(stub([])).benchmark();
    expect(r.measured).toBe(false);
    expect(r.verdict).toContain('Замер невозможен');
    expect(r.thresholds.talk).toBe(THRESHOLD_TALK);
  });

  it('заказы демо-продавцов в замер не входят', async () => {
    const r = await new RankingService(
      stub([
        { id: '1', sellerId: 's', status: 'completed', createdAt: d(1), completedAt: d(2), email: `x${DEMO_DOMAIN}` },
      ]),
    ).benchmark();
    expect(r.total).toBe(0);
    expect(r.verdict).toContain('демонстрационные');
  });

  it('спор — это проблемный заказ, даже если заказ потом завершили', async () => {
    const r = await new RankingService(
      stub([
        { id: '1', sellerId: 's', status: 'completed', createdAt: d(1), completedAt: d(3), dispute: { status: 'resolved_seller' } },
      ]),
    ).benchmark();
    expect(r.problem).toBe(1);
    expect(r.clean).toBe(0);
  });
});

describe('без подглядывания в будущее', () => {
  it('продажа, завершённая после заказа, не входит в опыт продавца на момент заказа', async () => {
    // Заказ A создан 1-го, завершён 10-го. Заказ B создан 5-го — в этот момент
    // у продавца ещё ноль завершённых продаж.
    const svc = new RankingService(
      stub([
        { id: 'A', sellerId: 's', status: 'completed', createdAt: d(1), completedAt: d(10) },
        { id: 'B', sellerId: 's', status: 'refunded', createdAt: d(5), completedAt: null },
        { id: 'C', sellerId: 's', status: 'completed', createdAt: d(12), completedAt: d(13) },
      ]),
    );
    const { cands } = await svc.collect();
    const by = Object.fromEntries(cands.map((c) => [c.key, c.sellerSalesBefore]));
    expect(by.B).toBe(0); // A завершён 10-го, после заказа B
    expect(by.C).toBe(1); // к 12-му A уже завершён
  });
});
