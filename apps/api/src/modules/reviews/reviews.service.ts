import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { maskContacts } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { assetUrl } from '../storage/asset-url';

/** Сколько дней покупатель может изменить или удалить отзыв. */
export const REVIEW_EDIT_DAYS = 14;
/** Фото к отзыву: скриншоты товара, переписки в игре — больше пяти не нужно. */
export const MAX_REVIEW_PHOTOS = 5;

const keysOf = (raw: Prisma.JsonValue | null | undefined): string[] =>
  Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [];

/**
 * Отзыв публичный: контакты в нём — тот же увод сделки мимо эскроу, что и
 * в чате. Пустая строка после обрезки — отсутствие текста, а не пустой отзыв.
 */
const clean = (text?: string | null) => {
  const t = text?.trim();
  return t ? maskContacts(t).masked : null;
};

@Injectable()
export class ReviewsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /** Фото к отзыву — через API, как фото лота; ключ — в папке автора. */
  async uploadImage(userId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    if (!this.storage.enabled) throw new NotFoundException('Хранилище недоступно');
    if (!file?.buffer?.length) throw new BadRequestException('Пустой файл');
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      throw new BadRequestException('Допустимы только изображения');
    }
    if (file.size > 8 * 1024 * 1024) throw new BadRequestException('Изображение больше 8 МБ');
    const ext = file.mimetype === 'image/jpeg' ? 'jpg' : file.mimetype.split('/')[1];
    const key = `reviews/${userId}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return { key, url: assetUrl(key) };
  }

  /**
   * Фото в отзыве — только загруженные самим автором: чужой ключ (фото из
   * другого отзыва или лота) не пройдёт.
   */
  private photos(authorId: string, keys: string[] | undefined): string[] | undefined {
    if (keys === undefined) return undefined;
    const list = [...new Set(keys)];
    if (list.length > MAX_REVIEW_PHOTOS) {
      throw new BadRequestException(`Не больше ${MAX_REVIEW_PHOTOS} фото к отзыву`);
    }
    const own = new RegExp(`^reviews/${authorId}/[0-9a-f-]{36}\\.(jpg|png|webp|gif)$`);
    if (list.some((k) => !own.test(k))) throw new BadRequestException('Фото не найдено — загрузите его заново');
    return list;
  }

  /** Убранные из отзыва фото — из хранилища; сбой не мешает отзыву. */
  private async dropPhotos(keys: string[]) {
    if (!keys.length || !this.storage.enabled) return;
    await Promise.all(keys.map((k) => this.storage.remove(k).catch(() => undefined)));
  }

  /** Отзыв оставляет покупатель по завершённой сделке — один на заказ. */
  async create(orderId: string, authorId: string, rating: number, comment?: string, images?: string[]) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== authorId) throw new ForbiddenException('Отзыв оставляет покупатель');
    if (order.status !== 'completed') throw new BadRequestException('Сделка ещё не завершена');

    const exists = await this.prisma.review.findUnique({ where: { orderId } });
    if (exists) throw new ConflictException('Отзыв по этому заказу уже есть');
    const photos = this.photos(authorId, images) ?? [];

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          orderId,
          authorId,
          targetId: order.sellerId,
          rating,
          comment: clean(comment),
          images: photos,
          photoCount: photos.length,
        },
      });
      await this.recomputeRating(tx, order.sellerId);
      return created;
    });

    await this.notifications.notify(order.sellerId, 'review_received', { orderId, rating });
    return review;
  }

  /** Взвешенный рейтинг: негативные оценки весят больше (как на FunPay). */
  private async recomputeRating(tx: Prisma.TransactionClient, targetId: string) {
    const rows = await tx.review.findMany({ where: { targetId }, select: { rating: true } });
    let wsum = 0;
    let rsum = 0;
    for (const r of rows) {
      const w = r.rating <= 2 ? 3 : r.rating === 3 ? 2 : 1;
      wsum += w;
      rsum += r.rating * w;
    }
    await tx.profile.update({
      where: { userId: targetId },
      data: { ratingAvg: wsum ? rsum / wsum : 0, ratingCount: rows.length },
    });
  }

  /** Ответ продавца на отзыв — один, его можно поправить. Покупатель узнаёт об ответе. */
  async reply(reviewId: string, sellerId: string, text: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Отзыв не найден');
    if (review.targetId !== sellerId) throw new ForbiddenException('Отвечать может только продавец');
    const sellerReply = clean(text);
    if (!sellerReply) throw new BadRequestException('Напишите ответ');
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { sellerReply, repliedAt: new Date() },
    });
    await this.notifications.notify(review.authorId, 'review_reply', { orderId: review.orderId });
    return updated;
  }

  /**
   * Покупатель меняет отзыв — в первые 14 дней. Без срока отзыв становится
   * рычагом давления: «поменяю на пять, если вернёте часть денег» через месяц.
   */
  async update(
    reviewId: string,
    authorId: string,
    input: { rating?: number; comment?: string | null; images?: string[] },
  ) {
    const review = await this.ownEditable(reviewId, authorId);
    const photos = this.photos(authorId, input.images);
    const before = keysOf(review.images);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.review.update({
        where: { id: reviewId },
        data: {
          ...(input.rating !== undefined ? { rating: input.rating } : {}),
          ...(input.comment !== undefined ? { comment: clean(input.comment) } : {}),
          ...(photos ? { images: photos, photoCount: photos.length } : {}),
          editedAt: new Date(),
        },
      });
      await this.recomputeRating(tx, review.targetId);
      return row;
    });
    if (photos) await this.dropPhotos(before.filter((k) => !photos.includes(k)));
    return updated;
  }

  /** Покупатель удаляет отзыв — в те же 14 дней; рейтинг пересчитывается. */
  async remove(reviewId: string, authorId: string) {
    const review = await this.ownEditable(reviewId, authorId);
    const photos = keysOf(review.images);
    await this.prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: reviewId } });
      await this.recomputeRating(tx, review.targetId);
    });
    await this.dropPhotos(photos);
    return { ok: true };
  }

  /** Отзыв по заказу — для страницы заказа: показать, изменить, ответить. */
  async forOrder(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('Нет доступа к заказу');
    }
    const review = await this.prisma.review.findUnique({ where: { orderId } });
    if (!review) return null;
    return {
      ...review,
      // Ключ — чтобы при правке оставить фото, адрес — чтобы показать.
      images: keysOf(review.images).map((key) => ({ key, url: assetUrl(key) })),
      editableUntil: new Date(review.createdAt.getTime() + REVIEW_EDIT_DAYS * 86_400_000),
    };
  }

  private async ownEditable(reviewId: string, authorId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Отзыв не найден');
    if (review.authorId !== authorId) throw new ForbiddenException('Менять отзыв может только его автор');
    if (Date.now() - review.createdAt.getTime() > REVIEW_EDIT_DAYS * 86_400_000) {
      throw new ForbiddenException(`Отзыв можно изменить в первые ${REVIEW_EDIT_DAYS} дней`);
    }
    return review;
  }

  /**
   * Отзывы о продавце для витрины, как на FunPay: оценка, текст, ответ, игра
   * и раздел сделки и вилка суммы. Точная сумма, заказ и покупатель наружу
   * не уходят — раньше список отдавал строки отзывов целиком, с id заказа,
   * id и ником покупателя.
   */
  async listForUser(
    userId: string,
    opts: { rating?: number; photos?: boolean; page?: number; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const page = Math.max(opts.page ?? 1, 1);
    const rows = await this.prisma.review.findMany({
      where: {
        targetId: userId,
        ...(opts.rating ? { rating: opts.rating } : {}),
        ...(opts.photos ? { photoCount: { gt: 0 } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        rating: true,
        comment: true,
        sellerReply: true,
        createdAt: true,
        editedAt: true,
        images: true,
        order: {
          select: {
            amount: true,
            currency: true,
            listing: {
              select: {
                game: { select: { slug: true, title: true } },
                category: { select: { slug: true, title: true } },
              },
            },
          },
        },
      },
    });
    return rows.map(({ order, images, ...r }) => ({
      ...r,
      images: keysOf(images).map((k) => assetUrl(k)!),
      game: order.listing.game,
      section: order.listing.category,
      amountRange: amountRange(order.amount, order.currency),
    }));
  }
}

/**
 * Сумма сделки вилкой: «1 000–5 000 ₽». Покупателю будущей сделки важен
 * масштаб, а точная сумма чужой покупки — лишнее.
 */
export function amountRange(amount: bigint, currency: string): string {
  const sign = currency === 'RUB' ? '₽' : currency;
  const rub = Number(amount) / 100;
  const edges = [500, 1_000, 5_000, 10_000, 50_000];
  const n = (v: number) => new Intl.NumberFormat('ru-RU').format(v);
  if (rub < edges[0]!) return `до ${n(edges[0]!)} ${sign}`;
  for (let i = 1; i < edges.length; i++) {
    if (rub < edges[i]!) return `${n(edges[i - 1]!)}–${n(edges[i]!)} ${sign}`;
  }
  return `от ${n(edges[edges.length - 1]!)} ${sign}`;
}
