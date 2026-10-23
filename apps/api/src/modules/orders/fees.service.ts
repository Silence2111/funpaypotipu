import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import {
  computeFees,
  effectiveSellerPct,
  sellerLevel,
  type FeeBreakdown,
  type SellerLevel,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

/** Резолв правила комиссии (category → global), скидка по уровню продавца, расчёт разбивки. */
@Injectable()
export class FeesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Курсы для показа цен в долларах и евро (рублей за единицу) или null, если не заданы. */
  async displayRates(): Promise<{ USD: number; EUR: number; setAt: string } | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: 'display_rates' } });
    const v = row?.value as { USD?: number; EUR?: number; setAt?: string } | undefined;
    return v && v.USD && v.EUR ? { USD: v.USD, EUR: v.EUR, setAt: v.setAt ?? '' } : null;
  }

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
    if (sellerId) level = await this.levelOf(sellerId);
    // Перевод bps → доля — только через shared: здесь раньше вычитали
    // процентные пункты из доли, и комиссия уровней обнулялась.
    const effSellerPct = effectiveSellerPct(sellerPct, level);

    return { ...computeFees(base, buyerPct, effSellerPct), level };
  }

  /** Активные правила комиссии по валюте — для публичного прайса. */
  activeRules(currency: string) {
    return this.prisma.feeRule.findMany({
      where: { active: true, currency },
      select: { scope: true, feeBuyerPct: true, feeSellerPct: true },
      orderBy: { priority: 'desc' },
    });
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
