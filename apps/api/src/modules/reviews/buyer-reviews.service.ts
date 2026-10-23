import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { langOf, say } from '../../i18n/texts';

/** Сколько дней после сделки продавец может поставить или поменять оценку. */
export const BUYER_REVIEW_DAYS = 30;
const CLOSED = ['completed', 'refunded'] as const;

/**
 * Оценка покупателя продавцом: «порекомендую» или нет, по одной на сделку.
 * Продавец видит в заказе, как покупатель вёл себя у других продавцов,
 * покупатель — свою оценку с комментарием; в профиле — только числа.
 */
@Injectable()
export class BuyerReviewsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  /** Покупатель в числах: завершённые покупки и оценки продавцов. */
  async stats(buyerId: string) {
    const [deals, good, bad] = await Promise.all([
      this.prisma.order.count({ where: { buyerId, status: 'completed' } }),
      this.prisma.buyerReview.count({ where: { buyerId, good: true } }),
      this.prisma.buyerReview.count({ where: { buyerId, good: false } }),
    ]);
    return { deals, good, bad };
  }

  /**
   * Оценка в заказе. Продавцу — его оценка, статистика покупателя и можно
   * ли ещё оценить; покупателю — оценка с комментарием, без статистики.
   */
  async forOrder(orderId: string, userId: string) {
    const order = await this.order(orderId);
    const seller = order.sellerId === userId;
    if (!seller && order.buyerId !== userId) throw new ForbiddenException('Нет доступа к заказу');
    const review = await this.prisma.buyerReview.findUnique({
      where: { orderId },
      select: { good: true, comment: true, createdAt: true, updatedAt: true },
    });
    return {
      review,
      canRate: seller && this.open(order),
      stats: seller ? await this.stats(order.buyerId) : null,
    };
  }

  async rate(orderId: string, sellerId: string, input: { good: boolean; comment?: string | null }) {
    const order = await this.order(orderId);
    if (order.sellerId !== sellerId)
      throw new ForbiddenException('Оценить покупателя может только продавец');
    if (!(CLOSED as readonly string[]).includes(order.status)) {
      throw new BadRequestException('Оценить покупателя можно после завершения сделки');
    }
    if (!this.open(order)) {
      throw new BadRequestException(
        `Оценку ставят в течение ${BUYER_REVIEW_DAYS} дней после сделки`,
      );
    }
    const comment = input.comment?.trim() || null;
    const existed = await this.prisma.buyerReview.findUnique({
      where: { orderId },
      select: { id: true },
    });
    const review = await this.prisma.buyerReview.upsert({
      where: { orderId },
      create: { orderId, sellerId, buyerId: order.buyerId, good: input.good, comment },
      update: { good: input.good, comment },
      select: { good: true, comment: true, createdAt: true, updatedAt: true },
    });
    // Уведомление — один раз, на первую оценку: правка не повод писать снова.
    if (!existed) {
      const [buyer, profile] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: order.buyerId }, select: { locale: true } }),
        this.prisma.profile.findUnique({ where: { userId: sellerId }, select: { username: true } }),
      ]);
      const lang = langOf(buyer?.locale);
      await this.notifications.notify(order.buyerId, 'buyer_review', {
        orderId,
        good: input.good,
        preview: say(
          lang,
          input.good
            ? '{seller} рекомендует вас как покупателя'
            : '{seller} не рекомендует вас как покупателя',
          {
            seller: profile?.username ?? '',
          },
        ),
      });
    }
    return review;
  }

  async remove(orderId: string, sellerId: string) {
    const order = await this.order(orderId);
    if (order.sellerId !== sellerId)
      throw new ForbiddenException('Оценить покупателя может только продавец');
    await this.prisma.buyerReview.deleteMany({ where: { orderId } });
    return { ok: true };
  }

  private async order(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true, status: true, updatedAt: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  /** Сделка закрыта и прошло не больше BUYER_REVIEW_DAYS дней. */
  private open(order: { status: string; updatedAt: Date }) {
    return (
      (CLOSED as readonly string[]).includes(order.status) &&
      Date.now() - order.updatedAt.getTime() <= BUYER_REVIEW_DAYS * 86_400_000
    );
  }
}
