import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

@Injectable()
export class FavoritesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async add(userId: string, listingId: string) {
    await this.prisma.favorite.upsert({
      where: { userId_listingId: { userId, listingId } },
      update: {},
      create: { userId, listingId },
    });
    return { ok: true };
  }

  async remove(userId: string, listingId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, listingId } });
    return { ok: true };
  }

  async listMine(userId: string) {
    const favs = await this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { listingId: true },
    });
    const ids = favs.map((f) => f.listingId);
    if (!ids.length) return [];

    const listings = await this.prisma.listing.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        price: true,
        currency: true,
        images: true,
        status: true,
        seller: { select: { profile: { select: { username: true, ratingAvg: true } } } },
      },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));
    return ids.map((id) => byId.get(id)).filter((l): l is (typeof listings)[number] => !!l);
  }
}
