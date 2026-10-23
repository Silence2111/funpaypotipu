import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { MSK_OFFSET_MS, mskDay, replyTime, sellerLevel } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { assetUrl } from '../storage/asset-url';
import { ONLINE_MS } from '../../common/presence';

@Injectable()
export class SellersService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Публичная витрина продавца: профиль, рейтинг, уровень, присутствие. */
  async publicProfile(sellerId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: sellerId },
      select: {
        userId: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        country: true,
        ratingAvg: true,
        ratingCount: true,
        salesCount: true,
        onlineAt: true,
        awaySince: true,
        replySamples: true,
        createdAt: true,
        user: { select: { status: true } },
      },
    });
    if (!profile || profile.user.status === 'banned') {
      throw new NotFoundException('Продавец не найден');
    }

    const verified = await this.isVerified(sellerId);
    const level = sellerLevel({
      salesCount: profile.salesCount,
      ratingAvg: profile.ratingAvg,
      ratingCount: profile.ratingCount,
      verified,
    });

    const [activeListings, now] = [
      await this.prisma.listing.count({ where: { sellerId, status: 'active' } }),
      Date.now(),
    ];
    const online = !!profile.onlineAt && now - profile.onlineAt.getTime() < ONLINE_MS;

    // Гистограмма рейтинга (сколько отзывов на каждую звезду) — как у FunPay.
    const grouped = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { targetId: sellerId },
      _count: { _all: true },
    });
    const ratingBreakdown = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: grouped.find((g) => g.rating === star)?._count._all ?? 0,
    }));
    // Отзывов с фото — для фильтра «С фото».
    const photoReviews = await this.prisma.review.count({
      where: { targetId: sellerId, photoCount: { gt: 0 } },
    });
    const followers = await this.prisma.sellerFollow.count({ where: { sellerId } });
    // Как покупатель: завершённые покупки и оценки продавцов — только числа.
    const [buyerDeals, buyerGood, buyerBad] = await Promise.all([
      this.prisma.order.count({ where: { buyerId: sellerId, status: 'completed' } }),
      this.prisma.buyerReview.count({ where: { buyerId: sellerId, good: true } }),
      this.prisma.buyerReview.count({ where: { buyerId: sellerId, good: false } }),
    ]);

    return {
      id: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: assetUrl(profile.avatarUrl),
      bio: profile.bio,
      country: profile.country,
      ratingAvg: profile.ratingAvg,
      ratingCount: profile.ratingCount,
      salesCount: profile.salesCount,
      activeListings,
      memberSince: profile.createdAt,
      onlineAt: profile.onlineAt,
      online,
      // «Обычно отвечает за …» — по живым ответам; null — ответов мало.
      replyTime: replyTime(profile.replySamples, now),
      // В отпуске: лоты сняты до возвращения — покупатель видит почему.
      away: profile.awaySince !== null,
      verified,
      level: { key: level.key, label: level.label },
      ratingBreakdown,
      photoReviews,
      followers,
      asBuyer: { deals: buyerDeals, good: buyerGood, bad: buyerBad },
    };
  }

  /**
   * «Сегодня» в кабинете продавца: сколько продано и заработано за день по
   * Москве (как в выписке) против вчера, просмотры лотов и что ждёт его
   * самого — выдать, споры, сообщения, закончившиеся лоты, скидки, которые
   * кончаются до полуночи. Продажа — заказ, оплаченный в этот день и не
   * отменённый и не возвращённый; заработано — выплата продавцу по нему.
   */
  async today(sellerId: string, now = new Date()) {
    const day = mskDay(now);
    const start = new Date(Date.parse(`${day}T00:00:00Z`) - MSK_OFFSET_MS);
    const end = new Date(start.getTime() + 86_400_000);
    const yesterday = new Date(start.getTime() - 86_400_000);
    const sold = (from: Date, to: Date) =>
      this.prisma.order.aggregate({
        where: {
          sellerId,
          paidAt: { gte: from, lt: to },
          status: { notIn: ['refunded', 'cancelled', 'expired'] },
        },
        _count: { _all: true },
        _sum: { sellerPayoutAmount: true },
      });
    const [
      todaySales,
      yesterdaySales,
      views,
      toDeliver,
      awaitingBuyer,
      disputes,
      unreadMessages,
      soldOut,
      salesEnding,
      listings,
    ] = await Promise.all([
      sold(start, end),
      sold(yesterday, start),
      this.prisma.listingViewDay.aggregate({
        where: { day: new Date(`${day}T00:00:00Z`), listing: { sellerId } },
        _sum: { views: true },
      }),
      this.prisma.order.count({ where: { sellerId, status: 'paid' } }),
      this.prisma.order.count({ where: { sellerId, status: 'delivered' } }),
      this.prisma.order.count({ where: { sellerId, status: 'disputed' } }),
      this.prisma.message.count({
        where: { readAt: null, senderId: { not: sellerId }, conversation: { sellerId } },
      }),
      this.prisma.listing.count({ where: { sellerId, status: 'sold_out' } }),
      this.prisma.listing.count({ where: { sellerId, saleUntil: { gt: now, lte: end } } }),
      this.prisma.listing.count({ where: { sellerId, status: { not: 'archived' } } }),
    ]);
    return {
      day,
      // Нет ни лотов, ни продаж — сводка не нужна: сайт её не покажет.
      seller: listings > 0 || (await this.prisma.order.count({ where: { sellerId }, take: 1 })) > 0,
      sales: {
        count: todaySales._count._all,
        earned: (todaySales._sum.sellerPayoutAmount ?? 0n).toString(),
      },
      yesterday: {
        count: yesterdaySales._count._all,
        earned: (yesterdaySales._sum.sellerPayoutAmount ?? 0n).toString(),
      },
      views: views._sum.views ?? 0,
      waiting: { toDeliver, awaitingBuyer, disputes, unreadMessages, soldOut, salesEnding },
    };
  }

  /** Аналитика для кабинета продавца (у FunPay/Playerok такого дашборда нет). */
  async dashboard(sellerId: string) {
    const [profile, activeListings, inProgress, completed] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { userId: sellerId },
        select: { ratingAvg: true, ratingCount: true, salesCount: true },
      }),
      this.prisma.listing.count({ where: { sellerId, status: 'active' } }),
      this.prisma.order.count({ where: { sellerId, status: { in: ['paid', 'delivered'] } } }),
      this.prisma.order.findMany({
        where: { sellerId, status: 'completed' },
        select: { sellerPayoutAmount: true, completedAt: true },
      }),
    ]);

    const revenueTotal = completed.reduce((s, o) => s + o.sellerPayoutAmount, 0n);
    const dayMs = 86400 * 1000;
    const now = Date.now();
    const since30 = now - 30 * dayMs;
    let revenue30 = 0n;
    let sales30 = 0;

    // Выручка по дням за 14 дней (для мини-графика).
    const series = Array.from({ length: 14 }, () => 0);
    for (const o of completed) {
      if (!o.completedAt) continue;
      const t = o.completedAt.getTime();
      if (t >= since30) {
        revenue30 += o.sellerPayoutAmount;
        sales30 += 1;
      }
      const daysAgo = Math.floor((now - t) / dayMs);
      if (daysAgo >= 0 && daysAgo < 14) {
        series[13 - daysAgo] += Number(o.sellerPayoutAmount);
      }
    }

    const verified = await this.isVerified(sellerId);
    const level = sellerLevel({
      salesCount: profile?.salesCount ?? 0,
      ratingAvg: profile?.ratingAvg ?? 0,
      ratingCount: profile?.ratingCount ?? 0,
      verified,
    });

    return {
      salesCount: profile?.salesCount ?? 0,
      revenueTotal: revenueTotal.toString(),
      sales30,
      revenue30: revenue30.toString(),
      activeListings,
      inProgress,
      ratingAvg: profile?.ratingAvg ?? 0,
      ratingCount: profile?.ratingCount ?? 0,
      level: { key: level.key, label: level.label },
      revenueSeries: series, // 14 дней, минорные единицы
    };
  }

  private async isVerified(sellerId: string) {
    const kyc = await this.prisma.kycVerification.findFirst({
      where: { userId: sellerId, status: 'approved', level: 'document' },
      select: { id: true },
    });
    return !!kyc;
  }
}
