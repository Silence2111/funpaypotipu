import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { ONLINE_MS } from '../../common/presence';

@Injectable()
export class CatalogService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  listGames() {
    return this.prisma.game.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
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
      }),
      this.prisma.$queryRaw<Array<{ category_id: string | null; sellers: bigint; online: bigint }>>`
        SELECT l.category_id,
               COUNT(DISTINCT l.seller_id) AS sellers,
               COUNT(DISTINCT l.seller_id) FILTER (WHERE p.online_at >= ${since}) AS online
        FROM listings l JOIN profiles p ON p.user_id = l.seller_id
        WHERE l.game_id = ${game.id}::uuid AND l.status = 'active'
        GROUP BY ROLLUP (l.category_id)`,
    ]);
    const countMap = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    const people = new Map(
      sellers.map((r) => [r.category_id, { sellers: Number(r.sellers), online: Number(r.online) }]),
    );
    return {
      ...game,
      sellers: people.get(null) ?? { sellers: 0, online: 0 },
      categories: game.categories.map((c) => ({
        ...c,
        listingCount: countMap.get(c.id) ?? 0,
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
          categories: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
            select: { id: true, slug: true, title: true },
          },
        },
      }),
      this.prisma.listing.groupBy({ by: ['categoryId'], where: { status: 'active' }, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ game_id: string; online: bigint }>>`
        SELECT l.game_id, COUNT(DISTINCT l.seller_id) AS online
        FROM listings l JOIN profiles p ON p.user_id = l.seller_id
        WHERE l.status = 'active' AND p.online_at >= ${since}
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
