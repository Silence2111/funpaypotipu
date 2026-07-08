import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

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

    // Счётчики активных лотов по категориям (как «Аккаунты 8» на FunPay).
    const counts = await this.prisma.listing.groupBy({
      by: ['categoryId'],
      where: { gameId: game.id, status: 'active' },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    return {
      ...game,
      categories: game.categories.map((c) => ({ ...c, listingCount: countMap.get(c.id) ?? 0 })),
    };
  }

  async getCategoryAttributes(categoryId: string) {
    return this.prisma.attribute.findMany({
      where: { categoryId },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
