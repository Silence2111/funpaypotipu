import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { maskContacts } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';

/** Сколько дней покупатель может изменить или удалить отзыв. */
export const REVIEW_EDIT_DAYS = 14;

/**
 * Отзыв публичный: контакты в нём — тот же увод сделки мимо эскроу, что и
 * в чате. Пустая строка после обрезки — отсутствие текста, а не пустой отзыв.
 */
const clean = (text?: string | null) => {
  const t = text?.trim();
  return t ? maskContacts(t).masked : null;
};

@Injectable()
export class ReviewsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  /** Отзыв оставляет покупатель по завершённой сделке — один на заказ. */
  async create(orderId: string, authorId: string, rating: number, comment?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== authorId) throw new ForbiddenException('Отзыв оставляет покупатель');
    if (order.status !== 'completed') throw new BadRequestException('Сделка ещё не завершена');

    const exists = await this.prisma.review.findUnique({ where: { orderId } });
    if (exists) throw new ConflictException('Отзыв по этому заказу уже есть');

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: { orderId, authorId, targetId: order.sellerId, rating, comment: clean(comment) },
      });
      await this.recomputeRating(tx, order.sellerId);
      return created;
    });

    await this.notifications.notify(order.sellerId, 'review_received', { orderId, rating });
    return review;
  }

  /** Взвешенный рейтинг: негативные оценки весят больше (как на FunPay). */
  private async recomputeRating(tx: Prisma.TransactionClient, targetId: string) {
    const rows = await tx.review.findMany({ where: { targetId }, select: { rating: true } });
    let wsum = 0;
    let rsum = 0;
    for (const r of rows) {
      const w = r.rating <= 2 ? 3 : r.rating === 3 ? 2 : 1;
      wsum += w;
      rsum += r.rating * w;
    }
    await tx.profile.update({
      where: { userId: targetId },
      data: { ratingAvg: wsum ? rsum / wsum : 0, ratingCount: rows.length },
    });
  }

  /** Ответ продавца на отзыв — один, его можно поправить. Покупатель узнаёт об ответе. */
  async reply(reviewId: string, sellerId: string, text: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Отзыв не найден');
    if (review.targetId !== sellerId) throw new ForbiddenException('Отвечать может только продавец');
    const sellerReply = clean(text);
    if (!sellerReply) throw new BadRequestException('Напишите ответ');
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { sellerReply, repliedAt: new Date() },
    });
    await this.notifications.notify(review.authorId, 'review_reply', { orderId: review.orderId });
    return updated;
  }

  /**
   * Покупатель меняет отзыв — в первые 14 дней. Без срока отзыв становится
   * рычагом давления: «поменяю на пять, если вернёте часть денег» через месяц.
   */
  async update(reviewId: string, authorId: string, input: { rating?: number; comment?: string | null }) {
    const review = await this.ownEditable(reviewId, authorId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.review.update({
        where: { id: reviewId },
        data: {
          ...(input.rating !== undefined ? { rating: input.rating } : {}),
          ...(input.comment !== undefined ? { comment: clean(input.comment) } : {}),
          editedAt: new Date(),
        },
      });
      await this.recomputeRating(tx, review.targetId);
      return updated;
    });
  }

  /** Покупатель удаляет отзыв — в те же 14 дней; рейтинг пересчитывается. */
  async remove(reviewId: string, authorId: string) {
    const review = await this.ownEditable(reviewId, authorId);
    await this.prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: reviewId } });
      await this.recomputeRating(tx, review.targetId);
    });
    return { ok: true };
  }

  /** Отзыв по заказу — для страницы заказа: показать, изменить, ответить. */
  async forOrder(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('Нет доступа к заказу');
    }
    const review = await this.prisma.review.findUnique({ where: { orderId } });
    if (!review) return null;
    return { ...review, editableUntil: new Date(review.createdAt.getTime() + REVIEW_EDIT_DAYS * 86_400_000) };
  }

  private async ownEditable(reviewId: string, authorId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Отзыв не найден');
    if (review.authorId !== authorId) throw new ForbiddenException('Менять отзыв может только его автор');
    if (Date.now() - review.createdAt.getTime() > REVIEW_EDIT_DAYS * 86_400_000) {
      throw new ForbiddenException(`Отзыв можно изменить в первые ${REVIEW_EDIT_DAYS} дней`);
    }
    return review;
  }

  listForUser(userId: string, limit = 50) {
    return this.prisma.review.findMany({
      where: { targetId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { author: { select: { profile: { select: { username: true } } } } },
    });
  }
}
