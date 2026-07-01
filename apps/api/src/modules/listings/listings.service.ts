import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import type { CreateListingInput, ListingQuery, UpdateListingInput } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

const cardSelect = {
  id: true,
  title: true,
  price: true,
  currency: true,
  images: true,
  status: true,
  createdAt: true,
  seller: { select: { profile: { select: { username: true, ratingAvg: true } } } },
  category: { select: { slug: true, title: true } },
  game: { select: { slug: true, title: true } },
} satisfies Prisma.ListingSelect;

@Injectable()
export class ListingsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async browse(query: ListingQuery) {
    const where: Prisma.ListingWhereInput = { status: 'active' };
    if (query.gameSlug) where.game = { slug: query.gameSlug };
    if (query.categorySlug) where.category = { slug: query.categorySlug };
    if (query.q) where.title = { contains: query.q, mode: 'insensitive' };
    if (query.minPrice != null || query.maxPrice != null) {
      where.price = {
        gte: query.minPrice != null ? BigInt(query.minPrice) : undefined,
        lte: query.maxPrice != null ? BigInt(query.maxPrice) : undefined,
      };
    }

    const orderBy: Prisma.ListingOrderByWithRelationInput =
      query.sort === 'price_asc'
        ? { price: 'asc' }
        : query.sort === 'price_desc'
          ? { price: 'desc' }
          : { createdAt: 'desc' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy,
        select: cardSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.listing.count({ where }),
    ]);

    return { items, total, page: query.page, limit: query.limit };
  }

  async getById(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: {
        ...cardSelect,
        description: true,
        attributes: true,
        fulfillmentType: true,
        salesCount: true,
      },
    });
    if (!listing || listing.status !== 'active') throw new NotFoundException('Лот не найден');
    return listing;
  }

  listMine(sellerId: string) {
    return this.prisma.listing.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      select: cardSelect,
    });
  }

  async create(sellerId: string, input: CreateListingInput) {
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, gameId: input.gameId },
    });
    if (!category) throw new NotFoundException('Категория не найдена для указанной игры');

    return this.prisma.listing.create({
      data: {
        sellerId,
        gameId: input.gameId,
        categoryId: input.categoryId,
        title: input.title,
        description: input.description,
        price: BigInt(input.price),
        currency: input.currency,
        attributes: input.attributes as Prisma.InputJsonValue,
        images: input.images as Prisma.InputJsonValue,
        stock: input.stock,
        status: 'active',
        fulfillmentType: category.fulfillmentType,
        autoDelivery: category.fulfillmentType !== 'manual',
      },
      select: cardSelect,
    });
  }

  async update(sellerId: string, id: string, input: UpdateListingInput) {
    await this.assertOwner(sellerId, id);
    const data: Prisma.ListingUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.price !== undefined) data.price = BigInt(input.price);
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.attributes !== undefined) data.attributes = input.attributes as Prisma.InputJsonValue;
    if (input.images !== undefined) data.images = input.images as Prisma.InputJsonValue;
    if (input.stock !== undefined) data.stock = input.stock;
    if (input.status !== undefined) data.status = input.status;

    return this.prisma.listing.update({ where: { id }, data, select: cardSelect });
  }

  async remove(sellerId: string, id: string) {
    await this.assertOwner(sellerId, id);
    await this.prisma.listing.delete({ where: { id } });
    return { ok: true };
  }

  private async assertOwner(sellerId: string, id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { sellerId: true },
    });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш лот');
  }
}
