import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

/** Сколько предложений отдавать: виджету нужно лучшее, а не весь рынок. */
const MAX_OFFERS = 20;

export interface TopupOfferView {
  listingId: string;
  title: string;
  currency: string;
  markupBps: number;
  /** Границы номинала, минорные единицы (bigint уходит в JSON строкой). */
  min: bigint;
  max: bigint;
  seller: { username: string | null };
}

/**
 * Предложения «на сумму покупателя» по игре — для виджета пополнения на главной.
 *
 * Цену здесь не считаем: виджет считает её сам той же функцией из shared
 * (`topupQuote`), что и заказ, поэтому цифра на кнопке и сумма в заказе не
 * расходятся, а ввод суммы не ходит в сеть на каждую цифру.
 */
@Injectable()
export class TopupService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async offers(gameSlug: string, currency = 'RUB') {
    const game = await this.prisma.game.findUnique({
      where: { slug: gameSlug },
      select: { slug: true, title: true, isActive: true },
    });
    if (!game || !game.isActive) throw new NotFoundException('Игра не найдена');

    const rows = await this.prisma.listing.findMany({
      where: {
        status: 'active',
        currency,
        fulfillmentType: 'provider',
        topupMarkupBps: { not: null },
        game: { slug: gameSlug },
      },
      // Дешёвые первыми; при равной наценке — у кого больше продаж, потом старший лот.
      orderBy: [{ topupMarkupBps: 'asc' }, { salesCount: 'desc' }, { createdAt: 'asc' }],
      take: MAX_OFFERS,
      select: {
        id: true,
        title: true,
        currency: true,
        topupMarkupBps: true,
        topupMin: true,
        topupMax: true,
        seller: { select: { profile: { select: { username: true } } } },
      },
    });

    const offers: TopupOfferView[] = [];
    for (const r of rows) {
      // CHECK в базе не даёт сохранить неполные условия; проверка — для типов.
      if (r.topupMarkupBps == null || r.topupMin == null || r.topupMax == null) continue;
      offers.push({
        listingId: r.id,
        title: r.title,
        currency: r.currency,
        markupBps: r.topupMarkupBps,
        min: r.topupMin,
        max: r.topupMax,
        seller: { username: r.seller.profile?.username ?? null },
      });
    }
    return { game: { slug: game.slug, title: game.title }, currency, offers };
  }
}
