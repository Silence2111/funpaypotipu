import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { computeFees, type FeeBreakdown } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

/** Резолв правила комиссии (category → global) и расчёт разбивки. */
@Injectable()
export class FeesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async computeForCategory(base: bigint, categoryId: string, currency: string): Promise<FeeBreakdown> {
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
    return computeFees(base, buyerPct, sellerPct);
  }
}
