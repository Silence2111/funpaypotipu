import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewsService } from '../src/modules/reviews/reviews.service';

/**
 * Отзывы — вторая валюта площадки после денег: от них зависит выдача и
 * доверие. Проверяется: кто может менять и в какой срок, что рейтинг
 * пересчитывается, что контакты не попадают в публичный текст.
 */

const DAY = 86_400_000;

function setup(review: Record<string, unknown> | null, others: Array<{ rating: number }> = []) {
  const state = { review: review ? { ...review } : null, profile: null as unknown, deleted: false };
  const tx = {
    review: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.review = { id: 'r1', createdAt: new Date(), ...data };
        return state.review;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.review!, data)),
      delete: vi.fn(async () => {
        state.deleted = true;
      }),
      findMany: vi.fn(async () => [...others, ...(state.review && !state.deleted ? [state.review as { rating: number }] : [])]),
    },
    profile: { update: vi.fn(async ({ data }: { data: unknown }) => (state.profile = data)) },
  };
  const prisma = {
    ...tx,
    review: { ...tx.review, findUnique: vi.fn(async () => (state.deleted ? null : state.review)) },
    order: {
      findUnique: vi.fn(async () => ({ id: 'o1', buyerId: 'b1', sellerId: 's1', status: 'completed' })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  return { svc: new ReviewsService(prisma as never, notifications as never), state, notifications };
}

const REVIEW = { id: 'r1', orderId: 'o1', authorId: 'b1', targetId: 's1', rating: 2, comment: 'долго', createdAt: new Date() };

beforeEach(() => vi.clearAllMocks());

describe('отзыв покупателя', () => {
  it('контакты в тексте отзыва скрываются', async () => {
    const { svc, state } = setup(null);
    // findUnique «уже есть отзыв?» должен вернуть null — отзыва ещё нет
    await svc.create('o1', 'b1', 5, 'всё ок, пишите мне в телеграм @buyer');
    expect((state.review as { comment: string }).comment).not.toMatch(/@buyer|телеграм/);
  });

  it('автор меняет оценку в первые 14 дней, рейтинг пересчитывается', async () => {
    const { svc, state } = setup(REVIEW, [{ rating: 5 }]);
    await svc.update('r1', 'b1', { rating: 5, comment: 'разобрались, всё хорошо' });
    expect((state.review as { rating: number; editedAt?: Date }).rating).toBe(5);
    expect((state.review as { editedAt?: Date }).editedAt).toBeInstanceOf(Date);
    expect(state.profile).toEqual({ ratingAvg: 5, ratingCount: 2 });
  });

  it('через 14 дней отзыв не меняется — иначе он становится рычагом давления', async () => {
    const { svc } = setup({ ...REVIEW, createdAt: new Date(Date.now() - 15 * DAY) });
    await expect(svc.update('r1', 'b1', { rating: 5 })).rejects.toThrow(/в первые 14 дней/);
  });

  it('чужой отзыв не меняется и не удаляется', async () => {
    const { svc } = setup(REVIEW);
    await expect(svc.update('r1', 's1', { rating: 5 })).rejects.toThrow(/только его автор/);
    await expect(svc.remove('r1', 's1')).rejects.toThrow(/только его автор/);
  });

  it('удаление отзыва пересчитывает рейтинг без него', async () => {
    const { svc, state } = setup(REVIEW, [{ rating: 5 }]);
    await svc.remove('r1', 'b1');
    expect(state.deleted).toBe(true);
    expect(state.profile).toEqual({ ratingAvg: 5, ratingCount: 1 });
  });
});

describe('ответ продавца', () => {
  it('отвечает только продавец, о котором отзыв', async () => {
    const { svc } = setup(REVIEW);
    await expect(svc.reply('r1', 'b1', 'спасибо')).rejects.toThrow(/только продавец/);
  });

  it('ответ без контактов, покупатель узнаёт о нём', async () => {
    const { svc, state, notifications } = setup(REVIEW);
    await svc.reply('r1', 's1', 'извините за задержку, пишите в whatsapp +7 999 123 45 67');
    expect((state.review as { sellerReply: string }).sellerReply).not.toMatch(/999|whatsapp/i);
    expect(notifications.notify).toHaveBeenCalledWith('b1', 'review_reply', { orderId: 'o1' });
  });

  it('пустой ответ не сохраняется', async () => {
    const { svc } = setup(REVIEW);
    await expect(svc.reply('r1', 's1', '   ')).rejects.toThrow(/Напишите ответ/);
  });
});
