import { describe, expect, it, vi } from 'vitest';
import {
  BUYER_REVIEW_DAYS,
  BuyerReviewsService,
} from '../src/modules/reviews/buyer-reviews.service';

/**
 * Оценка покупателя продавцом. Проверяется: оценивает только продавец и
 * только закрытую сделку в срок; уведомление — на первую оценку, правка
 * молчит; покупатель видит оценку без статистики, продавец — со статистикой.
 */

type Row = Record<string, unknown>;

function setup(opts: { order?: Row | null; existing?: Row | null } = {}) {
  const order =
    opts.order === undefined
      ? { buyerId: 'b1', sellerId: 's1', status: 'completed', updatedAt: new Date() }
      : opts.order;
  const prisma = {
    order: {
      findUnique: vi.fn(async () => order),
      count: vi.fn(async () => 7),
    },
    buyerReview: {
      findUnique: vi.fn(async () => opts.existing ?? null),
      upsert: vi.fn(async ({ create }: { create: Row }) => ({ ...create, createdAt: new Date() })),
      count: vi.fn(async ({ where }: { where: Row }) => (where.good ? 5 : 1)),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    user: { findUnique: vi.fn(async () => ({ locale: 'ru' })) },
    profile: { findUnique: vi.fn(async () => ({ username: 'seller1' })) },
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  return {
    svc: new BuyerReviewsService(prisma as never, notifications as never),
    prisma,
    notifications,
  };
}

describe('оценка покупателя', () => {
  it('только продавец, только закрытая сделка и в срок', async () => {
    await expect(setup().svc.rate('o1', 'b1', { good: true })).rejects.toThrow('только продавец');
    await expect(
      setup({
        order: { buyerId: 'b1', sellerId: 's1', status: 'paid', updatedAt: new Date() },
      }).svc.rate('o1', 's1', {
        good: true,
      }),
    ).rejects.toThrow('после завершения сделки');
    const old = new Date(Date.now() - (BUYER_REVIEW_DAYS + 1) * 86_400_000);
    await expect(
      setup({
        order: { buyerId: 'b1', sellerId: 's1', status: 'completed', updatedAt: old },
      }).svc.rate('o1', 's1', {
        good: false,
      }),
    ).rejects.toThrow(/в течение 30 дней/);
    await expect(setup({ order: null }).svc.rate('o1', 's1', { good: true })).rejects.toThrow(
      'Заказ не найден',
    );
  });

  it('первая оценка — уведомление покупателю; правка — без уведомления; пустой комментарий — null', async () => {
    const first = setup();
    await first.svc.rate('o1', 's1', { good: false, comment: '  ' });
    expect(first.prisma.buyerReview.upsert.mock.calls[0]![0]).toMatchObject({
      create: { orderId: 'o1', sellerId: 's1', buyerId: 'b1', good: false, comment: null },
    });
    expect(first.notifications.notify).toHaveBeenCalledWith('b1', 'buyer_review', {
      orderId: 'o1',
      good: false,
      preview: 'seller1 не рекомендует вас как покупателя',
    });
    const again = setup({ existing: { id: 'r1' } });
    await again.svc.rate('o1', 's1', { good: true, comment: 'Спасибо' });
    expect(again.notifications.notify).not.toHaveBeenCalled();
  });

  it('продавец видит статистику покупателя и может оценить; покупатель — только оценку; чужой — 403', async () => {
    const seller = await setup().svc.forOrder('o1', 's1');
    expect(seller).toMatchObject({ canRate: true, stats: { deals: 7, good: 5, bad: 1 } });
    const buyer = await setup().svc.forOrder('o1', 'b1');
    expect(buyer).toMatchObject({ canRate: false, stats: null });
    await expect(setup().svc.forOrder('o1', 'x')).rejects.toThrow('Нет доступа к заказу');
  });
});
