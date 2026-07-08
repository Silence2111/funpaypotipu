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

  private async isVerified(sellerId: string) {
    const kyc = await this.prisma.kycVerification.findFirst({
      where: { userId: sellerId, status: 'approved', level: 'document' },
      select: { id: true },
    });
    return !!kyc;
  }
}
