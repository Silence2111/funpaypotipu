import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@gamemarket/db';
import { benchmark, type BenchmarkReport, type RankCandidate } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

/** Домен, на который `db:seed:demo` кладёт продавцов. В замер они не входят. */
export const DEMO_DOMAIN = '@demo.gamemarket.local';

const CLEAN = new Set(['completed']);
const PROBLEM = new Set(['refunded', 'disputed']);

/**
 * Сбор настоящих заказов для замера выдачи. Единственная забота — не
 * подглядывать в будущее: продажи и рейтинг продавца считаются строго на
 * момент заказа, а не по текущему профилю. Иначе замер «угадывает», потому
 * что смотрел в ответ.
 */
@Injectable()
export class RankingService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async benchmark(): Promise<BenchmarkReport> {
    const { cands, demoDropped, realCount } = await this.collect();
    const caveats = [
      'У «поднятия» (boostUntil) нет истории, поэтому текущий порядок выдачи ' +
        'восстановлен как «новые первыми» без буста.',
      'Исход известен только по лотам, которые купили. Лоты, которые никто не ' +
        'выбрал, не наблюдаются — это смещение в пользу текущей выдачи.',
    ];
    if (demoDropped) caveats.push(`Отброшено демонстрационных заказов: ${demoDropped}.`);
    return benchmark(cands, { demoOnly: demoDropped > 0 && realCount === 0, caveats });
  }

  /** Кандидаты с признаками на момент заказа. Отдельно — чтобы это можно было проверить. */
  async collect(): Promise<{ cands: RankCandidate[]; demoDropped: number; realCount: number }> {
    const orders = await this.prisma.order.findMany({
      select: {
        id: true,
        sellerId: true,
        status: true,
        createdAt: true,
        completedAt: true,
        listingSnapshot: true,
        dispute: { select: { status: true } },
        seller: { select: { email: true } },
        listing: { select: { gameId: true, categoryId: true, price: true, createdAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const real = orders.filter((o) => !(o.seller.email ?? '').endsWith(DEMO_DOMAIN));
    const demoDropped = orders.length - real.length;

    const reviews = await this.prisma.review.findMany({
      where: { targetId: { in: [...new Set(real.map((o) => o.sellerId))] } },
      select: { targetId: true, rating: true, createdAt: true },
    });

    // Квадратичный проход сознательно: замер запускается редко, а до тысяч
    // заказов он читается проще оконного SQL. Дальше — переписать на окна.
    const cands: RankCandidate[] = real.map((o) => {
      const t = o.createdAt.getTime();
      const salesBefore = real.filter(
        (x) =>
          x.sellerId === o.sellerId &&
          x.status === 'completed' &&
          x.completedAt !== null &&
          x.completedAt.getTime() < t,
      ).length;
      const marks = reviews
        .filter((r) => r.targetId === o.sellerId && r.createdAt.getTime() < t)
        .map((r) => r.rating);
      // Спор — это уже то, от чего покупатель платит за защиту, даже если
      // арбитр потом встал на сторону продавца.
      const clean = o.dispute
        ? false
        : CLEAN.has(o.status)
          ? true
          : PROBLEM.has(o.status)
            ? false
            : null;
      const snapPrice = (o.listingSnapshot as { price?: string | number } | null)?.price;
      return {
        key: o.id,
        group: `${o.listing.gameId}:${o.listing.categoryId}`,
        price: Number(snapPrice ?? o.listing.price),
        sellerSalesBefore: salesBefore,
        sellerRatingBefore: marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null,
        listedAt: o.listing.createdAt.getTime(),
        clean,
      };
    });

    return { cands, demoDropped, realCount: real.length };
  }
}
