import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type CategorySegment, type FulfillmentType, type GameKind } from '@gamemarket/db';
import { CLOSED_REASON_DEFAULT } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { AuditService } from '../access/audit.service';
import { StorageService } from '../storage/storage.service';
import { assetUrl } from '../storage/asset-url';
import { SearchService } from '../search/search.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Типы полей раздела — как в справочнике (`packages/db/prisma/catalog.ts`). */
export const ATTRIBUTE_TYPES = ['enum', 'string', 'int', 'bool'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export interface GameInput {
  slug: string;
  title: string;
  kind: GameKind;
  aliases?: string[];
  /** Место в «Популярных»: 1 — первым, 100 — не в них. */
  sortOrder?: number;
}
export interface CategoryInput {
  slug: string;
  title: string;
  segment: CategorySegment;
  fulfillmentType: FulfillmentType;
  unitName?: string | null;
  pricePerUnits?: number | null;
}
export interface AttributeInput {
  key: string;
  label: string;
  type: AttributeType;
  options?: string[];
  isRequired?: boolean;
  isFilter?: boolean;
}

/** Обложка игры: картинка до 2 МБ. SVG — нет: в нём бывает скрипт. */
const COVER_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const COVER_MAX = 2 * 1024 * 1024;

const gameSnap = (g: { title: string; kind: string; aliases: string[]; isActive: boolean; sortOrder: number; coverUrl: string | null }) => ({
  title: g.title,
  kind: g.kind,
  aliases: g.aliases,
  isActive: g.isActive,
  sortOrder: g.sortOrder,
  coverUrl: g.coverUrl,
});
const categorySnap = (c: {
  title: string;
  segment: string;
  fulfillmentType: string;
  isActive: boolean;
  unitName: string | null;
  pricePerUnits: number | null;
  salesClosed: boolean;
  closedReason: string | null;
}) => ({
  title: c.title,
  segment: c.segment,
  fulfillmentType: c.fulfillmentType,
  isActive: c.isActive,
  unitName: c.unitName,
  pricePerUnits: c.pricePerUnits,
  salesClosed: c.salesClosed,
  closedReason: c.closedReason,
});
const attributeSnap = (a: { key: string; label: string; type: string; options: unknown; isRequired: boolean; isFilter: boolean }) => ({
  key: a.key,
  label: a.label,
  type: a.type,
  options: a.options ?? null,
  isRequired: a.isRequired,
  isFilter: a.isFilter,
});

/**
 * Каталог в консоли: игры, разделы и поля — добавить, изменить, скрыть,
 * переставить, обложка. Раньше всё это было только в сиде: под пришедшего
 * продавца игру заводил программист выкатом. Каждое действие — в журнале,
 * с тем, что было и что стало. Тронутое здесь получает `editedAt`, и сид
 * при выкате его больше не перезаписывает.
 */
@Injectable()
export class CatalogAdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly search: SearchService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Весь каталог со скрытым: игры, разделы, поля и сколько лотов в продаже. */
  async tree() {
    const [games, lots, held] = await Promise.all([
      this.prisma.game.findMany({
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        include: {
          categories: {
            orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
            include: { attributes: { orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] } },
          },
        },
      }),
      this.prisma.listing.groupBy({ by: ['categoryId'], where: { status: 'active' }, _count: { _all: true } }),
      // Сколько лотов вернётся, если раздел открыть.
      this.prisma.listing.groupBy({
        by: ['categoryId'],
        where: { pausedForSection: true, status: 'paused' },
        _count: { _all: true },
      }),
    ]);
    const active = new Map(lots.map((l) => [l.categoryId, l._count._all]));
    const paused = new Map(held.map((l) => [l.categoryId, l._count._all]));
    return games.map((g) => ({
      ...g,
      coverUrl: assetUrl(g.coverUrl),
      categories: g.categories.map((c) => ({
        ...c,
        activeListings: active.get(c.id) ?? 0,
        heldListings: paused.get(c.id) ?? 0,
      })),
    }));
  }

  // ── Игры ──

  async createGame(actorId: string, input: GameInput) {
    const exists = await this.prisma.game.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (exists) throw new ConflictException('Игра с таким адресом уже есть');
    const game = await this.prisma.game.create({
      data: {
        slug: input.slug,
        title: input.title,
        kind: input.kind,
        aliases: input.aliases ?? [],
        sortOrder: input.sortOrder ?? 100,
        editedAt: new Date(),
      },
    });
    await this.audit.log({ actorId, action: 'catalog.game.create', entityType: 'game', entityId: game.id, after: gameSnap(game) });
    return game;
  }

  async updateGame(actorId: string, id: string, input: Partial<Omit<GameInput, 'slug'>> & { isActive?: boolean }) {
    const before = await this.prisma.game.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Игра не найдена');
    const game = await this.prisma.game.update({ where: { id }, data: { ...input, editedAt: new Date() } });
    await this.audit.log({
      actorId,
      action: 'catalog.game.update',
      entityType: 'game',
      entityId: id,
      before: gameSnap(before),
      after: gameSnap(game),
    });
    return game;
  }

  async setCover(actorId: string, id: string, file: { buffer: Buffer; mimetype: string; size: number } | undefined) {
    const before = await this.prisma.game.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Игра не найдена');
    if (!this.storage.enabled) throw new NotFoundException('Хранилище недоступно');
    if (!file?.buffer?.length) throw new BadRequestException('Пустой файл');
    const ext = COVER_TYPES[file.mimetype];
    if (!ext) throw new BadRequestException('Обложка — PNG, JPEG или WebP');
    if (file.size > COVER_MAX) throw new BadRequestException('Обложка больше 2 МБ');
    // games/ — среди публичных папок /api/assets: обложку видят все.
    const key = `games/${id}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const game = await this.prisma.game.update({ where: { id }, data: { coverUrl: key, editedAt: new Date() } });
    if (before.coverUrl && !/^https?:/.test(before.coverUrl)) await this.storage.remove(before.coverUrl);
    await this.audit.log({
      actorId,
      action: 'catalog.game.cover',
      entityType: 'game',
      entityId: id,
      before: gameSnap(before),
      after: gameSnap(game),
    });
    return { ...game, coverUrl: assetUrl(game.coverUrl) };
  }

  // ── Разделы ──

  async createCategory(actorId: string, gameId: string, input: CategoryInput) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
    if (!game) throw new NotFoundException('Игра не найдена');
    const taken = await this.prisma.category.findUnique({
      where: { gameId_slug: { gameId, slug: input.slug } },
      select: { id: true },
    });
    if (taken) throw new ConflictException('Раздел с таким адресом в этой игре уже есть');
    const last = await this.prisma.category.aggregate({ where: { gameId }, _max: { sortOrder: true } });
    const category = await this.prisma.category.create({
      data: {
        gameId,
        slug: input.slug,
        title: input.title,
        segment: input.segment,
        fulfillmentType: input.fulfillmentType,
        unitName: input.unitName ?? null,
        pricePerUnits: input.pricePerUnits ?? null,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        editedAt: new Date(),
      },
    });
    await this.audit.log({
      actorId,
      action: 'catalog.category.create',
      entityType: 'category',
      entityId: category.id,
      after: categorySnap(category),
    });
    return category;
  }

  /**
   * Раздел: название, скрыть или показать, единица товара. Тип товара и
   * способ выдачи — только пока лотов нет: по ним уже считались комиссия и
   * выдача, и ключи не станут ручной выдачей задним числом.
   */
  async updateCategory(
    actorId: string,
    id: string,
    input: Partial<Omit<CategoryInput, 'slug'>> & { isActive?: boolean },
  ) {
    const before = await this.prisma.category.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Раздел не найден');
    const kindChanged =
      (input.segment && input.segment !== before.segment) ||
      (input.fulfillmentType && input.fulfillmentType !== before.fulfillmentType);
    if (kindChanged && (await this.prisma.listing.count({ where: { categoryId: id } }))) {
      throw new BadRequestException('В разделе уже есть лоты — тип товара и способ выдачи не меняются');
    }
    const category = await this.prisma.category.update({ where: { id }, data: { ...input, editedAt: new Date() } });
    await this.audit.log({
      actorId,
      action: 'catalog.category.update',
      entityType: 'category',
      entityId: id,
      before: categorySnap(before),
      after: categorySnap(category),
    });
    return category;
  }

  /**
   * Закрыть раздел для продажи или открыть (часть 122). Закрыть: новых
   * лотов нет, продающиеся и закончившиеся снимаются с витрины с отметкой
   * «раздел закрыт», продавцам — уведомление с причиной. Открыть: лоты с
   * отметкой возвращаются сами (без наличия — «закончился»), кроме лотов
   * заблокированных и замороженных продавцов. Открытые заказы не трогаем:
   * сделку нужно довести. Всё — в журнале.
   */
  async setSales(actorId: string, id: string, input: { closed: boolean; reason?: string | null }) {
    const before = await this.prisma.category.findUnique({ where: { id }, include: { game: { select: { title: true } } } });
    if (!before) throw new NotFoundException('Раздел не найден');
    const reason = input.closed ? input.reason?.trim() || before.closedReason || CLOSED_REASON_DEFAULT : null;
    if (before.salesClosed === input.closed && (!input.closed || reason === before.closedReason)) {
      return { ...before, changed: 0 };
    }
    const now = new Date();
    const affected = await this.prisma.listing.findMany({
      where: input.closed
        ? { categoryId: id, status: { in: ['active', 'sold_out'] } }
        : { categoryId: id, status: 'paused', pausedForSection: true },
      select: { id: true, sellerId: true, stock: true, seller: { select: { status: true } } },
    });
    const back = affected.filter((l) => l.seller.status === 'active');
    const [category] = await this.prisma.$transaction([
      this.prisma.category.update({
        where: { id },
        data: { salesClosed: input.closed, closedReason: reason, closedAt: now, editedAt: now },
      }),
      ...(input.closed
        ? [
            this.prisma.listing.updateMany({
              where: { id: { in: affected.map((l) => l.id) }, status: { in: ['active', 'sold_out'] } },
              data: { status: 'paused', pausedForSection: true },
            }),
          ]
        : [
            this.prisma.listing.updateMany({
              where: { id: { in: back.filter((l) => l.stock !== 0).map((l) => l.id) }, status: 'paused' },
              data: { status: 'active', pausedForSection: false },
            }),
            this.prisma.listing.updateMany({
              where: { id: { in: back.filter((l) => l.stock === 0).map((l) => l.id) }, status: 'paused' },
              data: { status: 'sold_out', pausedForSection: false },
            }),
            // Лоты заблокированных продавцов остаются снятыми: отметка
            // снимается, вернёт их снятие блокировки или сам продавец.
            this.prisma.listing.updateMany({
              where: { categoryId: id, pausedForSection: true },
              data: { pausedForSection: false },
            }),
          ]),
    ]);
    const moved = input.closed ? affected : back;
    for (const l of moved) {
      await this.search.indexListing(l.id).catch(() => undefined);
    }
    // Одно уведомление продавцу на раздел — сколько его лотов затронуто.
    const perSeller = new Map<string, number>();
    for (const l of moved) perSeller.set(l.sellerId, (perSeller.get(l.sellerId) ?? 0) + 1);
    for (const [sellerId, count] of perSeller) {
      await this.notifications.notify(sellerId, input.closed ? 'section_closed' : 'section_opened', {
        // Подробность в колокольчике, письме и пуше: какой раздел.
        preview: before.game ? `${before.game.title} · ${before.title}` : before.title,
        section: before.title,
        game: before.game?.title ?? '',
        count,
        ...(reason ? { reason } : {}),
      });
    }
    await this.audit.log({
      actorId,
      action: input.closed ? 'catalog.category.close' : 'catalog.category.open',
      entityType: 'category',
      entityId: id,
      before: categorySnap(before),
      after: { ...categorySnap(category), listings: moved.length },
    });
    return { ...category, changed: moved.length };
  }

  /** Порядок разделов игры: ровно её разделы, каждый — один раз. */
  async orderCategories(actorId: string, gameId: string, ids: string[]) {
    const current = await this.prisma.category.findMany({ where: { gameId }, select: { id: true, sortOrder: true } });
    this.assertSameSet(current.map((c) => c.id), ids, 'Список разделов устарел — обновите страницу');
    await this.prisma.$transaction(
      ids.map((cid, i) => this.prisma.category.update({ where: { id: cid }, data: { sortOrder: i + 1, editedAt: new Date() } })),
    );
    // Название — в записи: журнал покажет «игра «…»», а не id.
    const game = await this.prisma.game.findUnique({ where: { id: gameId }, select: { title: true } });
    await this.audit.log({
      actorId,
      action: 'catalog.category.order',
      entityType: 'game',
      entityId: gameId,
      before: { title: game?.title ?? null, order: [...current].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.id) },
      after: { title: game?.title ?? null, order: ids },
    });
    return { ok: true };
  }

  // ── Поля раздела ──

  async createAttribute(actorId: string, categoryId: string, input: AttributeInput) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) throw new NotFoundException('Раздел не найден');
    this.assertOptions(input.type, input.options);
    const taken = await this.prisma.attribute.findUnique({
      where: { categoryId_key: { categoryId, key: input.key } },
      select: { id: true },
    });
    if (taken) throw new ConflictException('Поле с таким ключом в разделе уже есть');
    const last = await this.prisma.attribute.aggregate({ where: { categoryId }, _max: { sortOrder: true } });
    const attribute = await this.prisma.attribute.create({
      data: {
        categoryId,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.type === 'enum' ? (input.options as Prisma.InputJsonValue) : Prisma.JsonNull,
        isRequired: input.isRequired ?? false,
        // Свободный текст в фильтре не сравнить — в фильтры он не идёт.
        isFilter: input.type === 'string' ? false : (input.isFilter ?? true),
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        editedAt: new Date(),
      },
    });
    await this.audit.log({
      actorId,
      action: 'catalog.attribute.create',
      entityType: 'attribute',
      entityId: attribute.id,
      after: attributeSnap(attribute),
    });
    return attribute;
  }

  /** Поле: подпись, варианты, обязательность, фильтр. Ключ и тип — нет: по ним хранятся значения в лотах. */
  async updateAttribute(actorId: string, id: string, input: Partial<Omit<AttributeInput, 'key' | 'type'>>) {
    const before = await this.prisma.attribute.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Поле не найдено');
    if (input.options !== undefined) this.assertOptions(before.type as AttributeType, input.options);
    const attribute = await this.prisma.attribute.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.options !== undefined && before.type === 'enum' ? { options: input.options } : {}),
        ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
        ...(input.isFilter !== undefined && before.type !== 'string' ? { isFilter: input.isFilter } : {}),
        editedAt: new Date(),
      },
    });
    await this.audit.log({
      actorId,
      action: 'catalog.attribute.update',
      entityType: 'attribute',
      entityId: id,
      before: attributeSnap(before),
      after: attributeSnap(attribute),
    });
    return attribute;
  }

  /**
   * Убрать поле: из формы и фильтров раздела. Значения в старых лотах
   * остаются в лоте, но больше нигде не показываются и не ищутся.
   */
  async deleteAttribute(actorId: string, id: string) {
    const before = await this.prisma.attribute.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Поле не найдено');
    await this.prisma.attribute.delete({ where: { id } });
    await this.audit.log({
      actorId,
      action: 'catalog.attribute.delete',
      entityType: 'attribute',
      entityId: id,
      before: attributeSnap(before),
    });
    return { ok: true };
  }

  async orderAttributes(actorId: string, categoryId: string, ids: string[]) {
    const current = await this.prisma.attribute.findMany({ where: { categoryId }, select: { id: true, sortOrder: true } });
    this.assertSameSet(current.map((a) => a.id), ids, 'Список полей устарел — обновите страницу');
    await this.prisma.$transaction(
      ids.map((aid, i) => this.prisma.attribute.update({ where: { id: aid }, data: { sortOrder: i + 1, editedAt: new Date() } })),
    );
    const category = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { title: true } });
    await this.audit.log({
      actorId,
      action: 'catalog.attribute.order',
      entityType: 'category',
      entityId: categoryId,
      before: { title: category?.title ?? null, order: [...current].sort((a, b) => a.sortOrder - b.sortOrder).map((a) => a.id) },
      after: { title: category?.title ?? null, order: ids },
    });
    return { ok: true };
  }

  private assertSameSet(have: string[], got: string[], message: string) {
    const a = new Set(have);
    if (got.length !== have.length || new Set(got).size !== got.length || got.some((id) => !a.has(id))) {
      throw new BadRequestException(message);
    }
  }

  /** У выбора из списка — от двух вариантов, без пустых и повторов. */
  private assertOptions(type: AttributeType, options?: string[]) {
    if (type !== 'enum') return;
    const list = (options ?? []).map((o) => o.trim());
    if (list.length < 2 || list.some((o) => !o) || new Set(list).size !== list.length) {
      throw new BadRequestException('У выбора из списка — от двух разных вариантов');
    }
  }
}
