import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { ONLINE_MS } from '../../common/presence';
import { utc } from '../../common/sql-time';
import { assetUrl } from '../storage/asset-url';

@Injectable()
export class CatalogService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // Обложка в базе — ключ хранилища (загружена в консоли), наружу — адрес.
  async listGames() {
    const games = await this.prisma.game.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
    return games.map((g) => ({ ...g, coverUrl: assetUrl(g.coverUrl) }));
  }

  async getGameBySlug(slug: string) {
    const game = await this.prisma.game.findUnique({
      where: { slug },
      include: {
        categories: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        },
      },
    });
    if (!game || !game.isActive) throw new NotFoundException('Игра не найдена');

    // Счётчики активных лотов по категориям (как «Аккаунты 8» на FunPay)
    // и сколько продавцов торгует и сколько из них в сети — по разделам и по
    // игре целиком (строка ROLLUP с category_id = null). Видно, что за
    // витриной живые люди, а не склад лотов.
    const since = new Date(Date.now() - ONLINE_MS);
    const [counts, sellers] = await Promise.all([
      this.prisma.listing.groupBy({
        by: ['categoryId'],
        where: { gameId: game.id, status: 'active' },
        _count: { _all: true },
        _min: { price: true },
      }),
      this.prisma.$queryRaw<Array<{ category_id: string | null; sellers: bigint; online: bigint }>>`
        SELECT l.category_id,
               COUNT(DISTINCT l.seller_id) AS sellers,
               COUNT(DISTINCT l.seller_id) FILTER (WHERE p.online_at >= ${utc(since)}) AS online
        FROM listings l JOIN profiles p ON p.user_id = l.seller_id
        WHERE l.game_id = ${game.id}::uuid AND l.status = 'active'
        GROUP BY ROLLUP (l.category_id)`,
    ]);
    const countMap = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    const minMap = new Map(counts.map((c) => [c.categoryId, c._min.price]));
    const people = new Map(
      sellers.map((r) => [r.category_id, { sellers: Number(r.sellers), online: Number(r.online) }]),
    );
    // «от 450 ₽» у раздела — для выдачи поиска и разметки цен. У валюты цена
    // — за пачку разного размера, у пополнения — наценка на сумму покупателя:
    // одной «цены от» у них нет.
    const minPrice = (c: { id: string; segment: string }) =>
      c.segment === 'currency' || c.segment === 'topup' ? null : (minMap.get(c.id)?.toString() ?? null);
    return {
      ...game,
      coverUrl: assetUrl(game.coverUrl),
      sellers: people.get(null) ?? { sellers: 0, online: 0 },
      categories: game.categories.map((c) => ({
        ...c,
        listingCount: countMap.get(c.id) ?? 0,
        minPrice: minPrice(c),
        sellers: people.get(c.id) ?? { sellers: 0, online: 0 },
      })),
    };
  }

  /**
   * Указатель игр А–Я: все игры с разделами и числом лотов, как список игр на
   * главной FunPay. Счётчики — одним запросом на все разделы. Синонимы — для
   * поиска по играм на сайте: «кс» находит Counter-Strike 2. У игры — сколько
   * её продавцов в сети.
   */
  async index() {
    const since = new Date(Date.now() - ONLINE_MS);
    const [games, counts, online] = await Promise.all([
      this.prisma.game.findMany({
        where: { isActive: true },
        orderBy: { title: 'asc' },
        select: {
          id: true,
          slug: true,
          title: true,
          kind: true,
          aliases: true,
          sortOrder: true,
          coverUrl: true,
          categories: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
            select: { id: true, slug: true, title: true, salesClosed: true },
          },
        },
      }),
      this.prisma.listing.groupBy({ by: ['categoryId'], where: { status: 'active' }, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ game_id: string; online: bigint }>>`
        SELECT l.game_id, COUNT(DISTINCT l.seller_id) AS online
        FROM listings l JOIN profiles p ON p.user_id = l.seller_id
        WHERE l.status = 'active' AND p.online_at >= ${utc(since)}
        GROUP BY l.game_id`,
    ]);
    const countMap = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    const onlineMap = new Map(online.map((r) => [r.game_id, Number(r.online)]));
    // Порядок — по правилам языка, а не по байтам базы: при сортировке базы
    // «EA Sports FC» вставал раньше «EA app», а кириллица перемешивалась.
    return games
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((g) => ({
        ...g,
        coverUrl: assetUrl(g.coverUrl),
        onlineSellers: onlineMap.get(g.id) ?? 0,
        categories: g.categories.map((c) => ({ ...c, listingCount: countMap.get(c.id) ?? 0 })),
      }));
  }

  async getCategoryAttributes(categoryId: string) {
    return this.prisma.attribute.findMany({
      where: { categoryId },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
