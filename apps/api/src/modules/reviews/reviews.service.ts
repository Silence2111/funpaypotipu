import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';

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
        data: { orderId, authorId, targetId: order.sellerId, rating, comment },
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

  async reply(reviewId: string, sellerId: string, text: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Отзыв не найден');
    if (review.targetId !== sellerId) throw new ForbiddenException('Отвечать может только продавец');
    return this.prisma.review.update({ where: { id: reviewId }, data: { sellerReply: text } });
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
