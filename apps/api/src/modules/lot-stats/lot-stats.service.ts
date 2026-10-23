import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import {
  MSK_OFFSET_MS,
  conversionPct,
  lastDays,
  mskDay,
  type StatsPeriod,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

/** Лот виден на сайте: в продаже или закончился, но открывается по ссылке. */
const VISIBLE = ['active', 'sold_out'];

/**
 * Статистика лотов продавца. Просмотры раньше не считались вовсе: поле
 * views_count у лота ничем не увеличивалось. Теперь страница лота отмечает
 * просмотр — браузер раз в сутки, без просмотров самого продавца, — и он
 * ложится в счётчик по дням (по Москве).
 */
@Injectable()
export class LotStatsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async recordView(listingId: string, viewerId: string | null) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true, status: true },
    });
    if (!listing || !VISIBLE.includes(listing.status) || listing.sellerId === viewerId) {
      return { counted: false };
    }
    const day = mskDay(new Date());
    // Сырым запросом: прибавить в одной строке без гонки, и не трогать
    // updated_at лота — просмотр его не меняет.
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        INSERT INTO listing_view_days (listing_id, day, views)
        VALUES (${listingId}::uuid, ${day}::date, 1)
        ON CONFLICT (listing_id, day) DO UPDATE SET views = listing_view_days.views + 1`,
      this.prisma.$executeRaw`
        UPDATE listings SET views_count = views_count + 1 WHERE id = ${listingId}::uuid`,
    ]);
    return { counted: true };
  }

  /**
   * За период: просмотры по дням и по лотам, сколько лотов в избранном
   * сейчас, покупки (заказы, оплаченные за период) и заработанное
   * (завершённые за период сделки, после комиссии). `listingId` — график
   * одного лота; таблица — всегда по всем.
   */
  async sellerStats(sellerId: string, days: StatsPeriod, listingId?: string) {
    const dayList = lastDays(days);
    const firstDay = new Date(`${dayList[0]}T00:00:00Z`);
    const start = new Date(firstDay.getTime() - MSK_OFFSET_MS);

    const lots = await this.prisma.listing.findMany({
      where: { sellerId, status: { not: 'archived' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        price: true,
        currency: true,
        unitName: true,
        pricePerUnits: true,
        topupMarkupBps: true,
        viewsCount: true,
      },
    });
    if (listingId && !lots.some((l) => l.id === listingId)) {
      throw new NotFoundException('Лот не найден');
    }
    const ids = lots.map((l) => l.id);
    const only = listingId ? [listingId] : ids;

    const [viewsByLot, viewsByDay, favorites, paid, earned] = await Promise.all([
      this.prisma.listingViewDay.groupBy({
        by: ['listingId'],
        where: { listingId: { in: ids }, day: { gte: firstDay } },
        _sum: { views: true },
      }),
      this.prisma.listingViewDay.groupBy({
        by: ['day'],
        where: { listingId: { in: only }, day: { gte: firstDay } },
        _sum: { views: true },
      }),
      this.prisma.favorite.groupBy({
        by: ['listingId'],
        where: { listingId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.order.findMany({
        where: { sellerId, listingId: { in: ids }, paidAt: { gte: start } },
        select: { listingId: true, paidAt: true },
      }),
      this.prisma.order.groupBy({
        by: ['listingId'],
        where: {
          sellerId,
          listingId: { in: ids },
          status: 'completed',
          completedAt: { gte: start },
        },
        _sum: { sellerPayoutAmount: true },
      }),
    ]);

    const views = new Map(viewsByLot.map((v) => [v.listingId, v._sum.views ?? 0]));
    const favs = new Map(favorites.map((f) => [f.listingId, f._count._all]));
    const money = new Map(earned.map((e) => [e.listingId, e._sum.sellerPayoutAmount ?? 0n]));
    const bought = new Map<string, number>();
    for (const o of paid) bought.set(o.listingId, (bought.get(o.listingId) ?? 0) + 1);

    const rows = lots
      .map((l) => {
        const v = views.get(l.id) ?? 0;
        const p = bought.get(l.id) ?? 0;
        return {
          id: l.id,
          title: l.title,
          status: l.status,
          price: l.price.toString(),
          currency: l.currency,
          unitName: l.unitName,
          pricePerUnits: l.pricePerUnits,
          topupMarkupBps: l.topupMarkupBps,
          views: v,
          totalViews: l.viewsCount,
          favorites: favs.get(l.id) ?? 0,
          purchases: p,
          earned: (money.get(l.id) ?? 0n).toString(),
          conversion: conversionPct(p, v),
        };
      })
      .sort((a, b) => b.views - a.views || b.purchases - a.purchases);

    // День хранится датой (полночь UTC) — строкой он тот же, что московский.
    const dayViews = new Map(
      viewsByDay.map((d) => [d.day.toISOString().slice(0, 10), d._sum.views ?? 0]),
    );
    const dayBought = new Map<string, number>();
    for (const o of paid) {
      if (listingId && o.listingId !== listingId) continue;
      const day = mskDay(o.paidAt!);
      dayBought.set(day, (dayBought.get(day) ?? 0) + 1);
    }

    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    const totalViews = sum((r) => r.views);
    const totalPurchases = sum((r) => r.purchases);
    return {
      days,
      from: dayList[0],
      to: dayList[dayList.length - 1],
      listingId: listingId ?? null,
      totals: {
        views: totalViews,
        favorites: sum((r) => r.favorites),
        purchases: totalPurchases,
        earned: rows.reduce((s, r) => s + BigInt(r.earned), 0n).toString(),
        conversion: conversionPct(totalPurchases, totalViews),
      },
      daily: dayList.map((day) => ({
        day,
        views: dayViews.get(day) ?? 0,
        purchases: dayBought.get(day) ?? 0,
      })),
      lots: rows,
    };
  }
}
