import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

export interface PromoInput {
  code: string;
  type: 'percent' | 'fixed';
  value: number; // percent: 10 = 10%; fixed: минорные единицы
  maxUses?: number;
  validUntil?: string;
}

@Injectable()
export class PromoService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Предпросмотр промокода (для UI). */
  async preview(code: string) {
    const p = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!p || !this.isLive(p)) throw new NotFoundException('Промокод недействителен');
    return { code: p.code, type: p.type, value: Number(p.value) };
  }

  /**
   * Списать промокод под заказ: считает скидку, атомарно инкрементит usedCount.
   * Скидка ограничена maxDiscount (комиссией площадки) и суммой заказа. 0 — если невалиден.
   */
  async consume(code: string, gross: bigint, maxDiscount: bigint): Promise<bigint> {
    const p = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!p || !this.isLive(p)) return 0n;

    let discount = p.type === 'percent' ? (gross * p.value) / 100n : p.value;
    if (discount > maxDiscount) discount = maxDiscount;
    if (discount > gross) discount = gross;
    if (discount <= 0n) return 0n;

    // Гонка на исчерпание лимита: инкремент только если ещё есть использования.
    const res = await this.prisma.promoCode.updateMany({
      where: { id: p.id, ...(p.maxUses != null ? { usedCount: { lt: p.maxUses } } : {}) },
      data: { usedCount: { increment: 1 } },
    });
    return res.count === 1 ? discount : 0n;
  }

  // ── Админ ──
  create(input: PromoInput) {
    if (input.type === 'percent' && (input.value <= 0 || input.value > 100)) {
      throw new BadRequestException('Процент должен быть в диапазоне 1..100');
    }
    return this.prisma.promoCode.create({
      data: {
        code: input.code.toUpperCase(),
        type: input.type,
        value: BigInt(input.value),
        maxUses: input.maxUses ?? null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
      },
    });
  }

  list() {
    return this.prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  private isLive(p: { usedCount: number; maxUses: number | null; validUntil: Date | null }): boolean {
    if (p.validUntil && p.validUntil < new Date()) return false;
    if (p.maxUses != null && p.usedCount >= p.maxUses) return false;
    return true;
  }
}
