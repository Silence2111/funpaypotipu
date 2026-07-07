import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@gamemarket/db';
import type { CreateListingInput, ListingQuery, UpdateListingInput } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { SearchService } from '../search/search.service';
import { StorageService } from '../storage/storage.service';

const ASSET_BASE = process.env.PUBLIC_ASSET_BASE ?? '';

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
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly search: SearchService,
    private readonly storage: StorageService,
  ) {}

  /** Загрузка изображения лота через API (MinIO приватный; отдача через /assets). */
  async uploadImage(sellerId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    if (!this.storage.enabled) throw new NotFoundException('Хранилище недоступно');
    if (!file?.buffer?.length) throw new BadRequestException('Пустой файл');
    if (!/^image\//.test(file.mimetype)) throw new BadRequestException('Допустимы только изображения');
    if (file.size > 8 * 1024 * 1024) throw new BadRequestException('Изображение больше 8 МБ');
    const ext = file.mimetype.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
    const key = `listings/${sellerId}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return { key };
  }

  /** Ключи S3 → абсолютные URL для показа (или оставляем уже готовые http-ссылки). */
  private resolveImages<T extends { images: unknown }>(row: T): T {
    const imgs = Array.isArray(row.images) ? (row.images as string[]) : [];
    const resolved = imgs.map((k) =>
      /^https?:\/\//.test(k) ? k : `${ASSET_BASE}/api/assets?key=${encodeURIComponent(k)}`,
    );
    return { ...row, images: resolved };
  }

  async browse(query: ListingQuery) {
    // Текстовый запрос + доступный движок → релевантный поиск с typo-tolerance.
    if (query.q && this.search.enabled) {
      const found = await this.search.searchIds(
        query.q,
        {
          gameSlug: query.gameSlug,
          categorySlug: query.categorySlug,
          minPrice: query.minPrice,
          maxPrice: query.maxPrice,
        },
        query.limit,
        (query.page - 1) * query.limit,
      );
      if (found) {
        const rows = await this.prisma.listing.findMany({
          where: { id: { in: found.ids } },
          select: cardSelect,
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        const items = found.ids
          .map((id) => byId.get(id))
          .filter((x): x is (typeof rows)[number] => !!x)
          .map((r) => this.resolveImages(r));
        return { items, total: found.total, page: query.page, limit: query.limit };
      }
    }

    // Fallback: Postgres.
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

    return {
      items: items.map((r) => this.resolveImages(r)),
      total,
      page: query.page,
      limit: query.limit,
    };
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
        seller: {
          select: {
            id: true,
            profile: { select: { username: true, ratingAvg: true, ratingCount: true } },
          },
        },
      },
    });
    if (!listing || listing.status !== 'active') throw new NotFoundException('Лот не найден');
    return this.resolveImages(listing);
  }

  async listMine(sellerId: string) {
    const rows = await this.prisma.listing.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      select: cardSelect,
    });
    return rows.map((r) => this.resolveImages(r));
  }

  async create(sellerId: string, input: CreateListingInput) {
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, gameId: input.gameId },
    });
    if (!category) throw new NotFoundException('Категория не найдена для указанной игры');

    const created = await this.prisma.listing.create({
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
    await this.search.indexListing(created.id);
    return created;
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

    const updated = await this.prisma.listing.update({ where: { id }, data, select: cardSelect });
    await this.search.indexListing(id);
    return updated;
  }

  async remove(sellerId: string, id: string) {
    await this.assertOwner(sellerId, id);
    await this.prisma.listing.delete({ where: { id } });
    await this.search.removeListing(id);
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
