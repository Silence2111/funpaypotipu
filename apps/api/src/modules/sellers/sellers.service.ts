import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { sellerLevel } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

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
    const online = !!profile.onlineAt && now - profile.onlineAt.getTime() < 5 * 60 * 1000;

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

    return {
      id: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      country: profile.country,
      ratingAvg: profile.ratingAvg,
      ratingCount: profile.ratingCount,
      salesCount: profile.salesCount,
      activeListings,
      memberSince: profile.createdAt,
      onlineAt: profile.onlineAt,
      online,
      verified,
      level: { key: level.key, label: level.label },
      ratingBreakdown,
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
