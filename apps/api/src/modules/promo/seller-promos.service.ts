import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { MAX_SELLER_PROMOS, normalizePromoCode, promoCodeError } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

export interface SellerPromoInput {
  code: string;
  percent: number;
  maxUses?: number | null;
  /** Сколько дней действует; нет — без срока. */
  days?: number | null;
  repeatOnly?: boolean;
}

/** Отменённый и истёкший заказ использование кода не занимает. */
const LIVE = {
  order: { status: { notIn: ['cancelled', 'expired'] as Array<'cancelled' | 'expired'> } },
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Промокоды продавца: скидка за его счёт, один раз на покупателя, с
 * пределом использований, сроком и «только постоянным». Заказ по коду
 * проверяется и создаётся в одной транзакции с блокировкой кода: два
 * заказа не займут последнее использование вдвоём.
 */
@Injectable()
export class SellerPromosService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(sellerId: string) {
    const rows = await this.prisma.sellerPromo.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { uses: { where: LIVE } } } },
    });
    return rows.map(({ _count, ...p }) => ({ ...p, used: _count.uses }));
  }

  async create(sellerId: string, input: SellerPromoInput) {
    const code = normalizePromoCode(input.code);
    const err = promoCodeError(code);
    if (err) throw new BadRequestException(err);
    const count = await this.prisma.sellerPromo.count({ where: { sellerId } });
    if (count >= MAX_SELLER_PROMOS) {
      throw new BadRequestException(`Не больше ${MAX_SELLER_PROMOS} промокодов — удалите ненужные`);
    }
    const taken = await this.prisma.sellerPromo.findUnique({
      where: { sellerId_code: { sellerId, code } },
      select: { id: true },
    });
    if (taken) throw new BadRequestException('Такой код у вас уже есть');
    const row = await this.prisma.sellerPromo.create({
      data: {
        sellerId,
        code,
        percent: input.percent,
        maxUses: input.maxUses ?? null,
        validUntil: input.days ? new Date(Date.now() + input.days * 86_400_000) : null,
        repeatOnly: input.repeatOnly ?? false,
      },
    });
    return { ...row, used: 0 };
  }

  async setActive(sellerId: string, id: string, active: boolean) {
    const r = await this.prisma.sellerPromo.updateMany({
      where: { id, sellerId },
      data: { active },
    });
    if (!r.count) throw new NotFoundException('Промокод не найден');
    return { id, active };
  }

  async remove(sellerId: string, id: string) {
    const r = await this.prisma.sellerPromo.deleteMany({ where: { id, sellerId } });
    if (!r.count) throw new NotFoundException('Промокод не найден');
    return { ok: true };
  }

  /**
   * Код продавца этого лота для покупателя. null — у продавца такого кода
   * нет: это может быть код площадки. Код есть, но не подходит — отказ с
   * причиной: покупатель ждёт скидку и должен знать, почему её нет.
   * `lock` — внутри транзакции заказа: код блокируется до её конца.
   */
  async check(
    rawCode: string,
    listing: { sellerId: string; topupMarkupBps: number | null },
    buyerId: string | null,
    db: Db = this.prisma,
    lock = false,
  ): Promise<{ id: string; code: string; percent: number } | null> {
    const code = normalizePromoCode(rawCode);
    const promo = await db.sellerPromo.findUnique({
      where: { sellerId_code: { sellerId: listing.sellerId, code } },
    });
    if (!promo) return null;
    if (lock)
      await db.$queryRaw`SELECT id FROM seller_promos WHERE id = ${promo.id}::uuid FOR UPDATE`;
    if (!promo.active) throw new BadRequestException('Продавец выключил этот промокод');
    if (promo.validUntil && promo.validUntil <= new Date()) {
      throw new BadRequestException('Срок промокода продавца истёк');
    }
    if (listing.topupMarkupBps != null) {
      throw new BadRequestException('Промокод продавца не действует на пополнение');
    }
    if (promo.maxUses != null) {
      const used = await db.sellerPromoUse.count({ where: { promoId: promo.id, ...LIVE } });
      if (used >= promo.maxUses) throw new BadRequestException('Промокод продавца закончился');
    }
    if (buyerId) {
      const mine = await db.sellerPromoUse.count({
        where: { promoId: promo.id, buyerId, ...LIVE },
      });
      if (mine > 0) throw new BadRequestException('Вы уже покупали по этому промокоду');
      if (promo.repeatOnly) {
        const before = await db.order.count({
          where: { buyerId, sellerId: listing.sellerId, status: 'completed' },
        });
        if (!before) {
          throw new BadRequestException('Промокод — для тех, кто уже покупал у этого продавца');
        }
      }
    }
    return { id: promo.id, code: promo.code, percent: promo.percent };
  }
}
