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
    return game;
  }

  async getCategoryAttributes(categoryId: string) {
    return this.prisma.attribute.findMany({
      where: { categoryId },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
