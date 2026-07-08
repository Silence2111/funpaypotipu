import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { computeFees, sellerLevel, type FeeBreakdown, type SellerLevel } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

/** Резолв правила комиссии (category → global), скидка по уровню продавца, расчёт разбивки. */
@Injectable()
export class FeesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Комиссия сделки. Если передан sellerId — комиссия ПРОДАВЦА уменьшается на
   * скидку его уровня (наш дифференциатор против плоских 10–20% у конкурентов).
   * Покупатель платит столько же; площадка берёт меньше, продавец получает больше.
   */
  async computeForCategory(
    base: bigint,
    categoryId: string,
    currency: string,
    sellerId?: string,
  ): Promise<FeeBreakdown & { level?: SellerLevel }> {
    const rule =
      (await this.prisma.feeRule.findFirst({
        where: { active: true, scope: 'category', scopeRef: categoryId, currency },
        orderBy: { priority: 'desc' },
      })) ??
      (await this.prisma.feeRule.findFirst({
        where: { active: true, scope: 'global', currency },
        orderBy: { priority: 'desc' },
      }));

    const buyerPct = rule?.feeBuyerPct ?? 0;
    const sellerPct = rule?.feeSellerPct ?? 0;

    let level: SellerLevel | undefined;
    let effSellerPct = sellerPct;
    if (sellerId) {
      level = await this.levelOf(sellerId);
      effSellerPct = Math.max(0, sellerPct - level.feeDiscountBps / 100);
    }

    return { ...computeFees(base, buyerPct, effSellerPct), level };
  }

  /** Уровень продавца из продаж + рейтинга + верификации. */
  async levelOf(sellerId: string): Promise<SellerLevel> {
    const [profile, kyc] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { userId: sellerId },
        select: { salesCount: true, ratingAvg: true, ratingCount: true },
      }),
      this.prisma.kycVerification.findFirst({
        where: { userId: sellerId, status: 'approved', level: 'document' },
        select: { id: true },
      }),
    ]);
    return sellerLevel({
      salesCount: profile?.salesCount ?? 0,
      ratingAvg: profile?.ratingAvg ?? 0,
      ratingCount: profile?.ratingCount ?? 0,
      verified: !!kyc,
    });
  }
}
