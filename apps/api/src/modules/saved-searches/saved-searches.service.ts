import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaClient } from '@gamemarket/db';
import {
  MAX_SAVED_SEARCHES,
  sameSearch,
  searchAttrs,
  searchPath,
  type SearchAttrs,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { listingFilters } from '../listings/listings.service';
import { langOf, say } from '../../i18n/texts';

/** Как часто искать новые лоты по сохранённым поискам. В CI — чаще. */
const SWEEP_MS = Number(process.env.SAVED_SEARCH_INTERVAL_MS ?? 5 * 60_000);
/** Сколько новых лотов одного поиска разбирать за проход. */
const BATCH = 50;

export interface SearchInput {
  categoryId: string;
  attrs?: Record<string, unknown>;
  q?: string | null;
  /** Минорные единицы; null — без предела. */
  maxPrice?: number | null;
  notify?: boolean;
}

const SELECT = {
  id: true,
  categoryId: true,
  attrs: true,
  q: true,
  maxPrice: true,
  notify: true,
  createdAt: true,
  lastHitAt: true,
  category: {
    select: {
      slug: true,
      title: true,
      game: { select: { slug: true, title: true } },
      attributes: { select: { key: true, label: true }, orderBy: { sortOrder: 'asc' as const } },
    },
  },
} as const;

/**
 * Сохранённые поиски покупателя: фильтры раздела и «цена до». Раз в
 * несколько минут фоновая задача ищет лоты, выставленные после сохранения,
 * тем же запросом, что показывает раздел, и присылает уведомление — о
 * каждом лоте один раз. Свои лоты и лоты из чёрного списка — в обе стороны —
 * не приходят.
 */
@Injectable()
export class SavedSearchesService {
  private readonly logger = new Logger(SavedSearchesService.name);
  private running = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.savedSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: SELECT,
    });
    return rows.map((r) => this.view(r));
  }

  private view(r: {
    id: string;
    categoryId: string;
    attrs: unknown;
    q: string | null;
    maxPrice: bigint | null;
    notify: boolean;
    createdAt: Date;
    lastHitAt: Date | null;
    category: {
      slug: string;
      title: string;
      game: { slug: string; title: string } | null;
      attributes: Array<{ key: string; label: string }>;
    };
  }) {
    const game = r.category.game;
    const attrs = searchAttrs(r.attrs);
    const maxPrice = r.maxPrice?.toString() ?? null;
    return {
      id: r.id,
      categoryId: r.categoryId,
      game,
      category: { slug: r.category.slug, title: r.category.title },
      // Подписи параметров — сайту: «Звание: Global Elite», а не «rank».
      labels: Object.fromEntries(
        r.category.attributes.filter((a) => a.key in attrs).map((a) => [a.key, a.label]),
      ),
      attrs,
      q: r.q,
      maxPrice,
      notify: r.notify,
      createdAt: r.createdAt,
      lastHitAt: r.lastHitAt,
      path: game ? searchPath(game.slug, r.category.slug, { attrs, q: r.q, maxPrice }) : null,
    };
  }

  /**
   * Параметры — только фильтры этого раздела и их варианты: иначе поиск не
   * совпал бы ни с чем, и человек ждал бы уведомления напрасно.
   */
  private async checkAttrs(categoryId: string, raw: unknown): Promise<SearchAttrs> {
    const attrs = searchAttrs(raw);
    if (!Object.keys(attrs).length) return attrs;
    const known = await this.prisma.attribute.findMany({
      where: { categoryId, key: { in: Object.keys(attrs) }, isFilter: true },
      select: { key: true, type: true, options: true },
    });
    for (const [key, value] of Object.entries(attrs)) {
      const a = known.find((k) => k.key === key);
      const options = Array.isArray(a?.options) ? (a.options as unknown[]) : [];
      const ok =
        a && (a.type === 'bool' ? value === true : a.type === 'enum' && options.includes(value));
      if (!ok) throw new BadRequestException('В разделе нет такого фильтра');
    }
    return attrs;
  }

  /** Такой же поиск у человека уже есть — второй прислал бы те же лоты. */
  private async assertUnique(
    userId: string,
    filters: { categoryId: string; attrs: SearchAttrs; q: string | null; maxPrice: string | null },
    selfId?: string,
  ) {
    const same = await this.prisma.savedSearch.findMany({
      where: { userId, categoryId: filters.categoryId, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { attrs: true, q: true, maxPrice: true, categoryId: true },
    });
    const dup = same.some((s) =>
      sameSearch(filters, {
        categoryId: s.categoryId,
        attrs: searchAttrs(s.attrs),
        q: s.q,
        maxPrice: s.maxPrice?.toString() ?? null,
      }),
    );
    if (dup) throw new BadRequestException('Такой поиск уже сохранён');
  }

  async create(userId: string, input: SearchInput) {
    // Поиск — по разделу игры: у него есть страница, куда вести из уведомления.
    const category = await this.prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { gameId: true },
    });
    if (!category?.gameId) throw new NotFoundException('Раздел не найден');
    const count = await this.prisma.savedSearch.count({ where: { userId } });
    if (count >= MAX_SAVED_SEARCHES) {
      throw new BadRequestException(`Не больше ${MAX_SAVED_SEARCHES} поисков — удалите ненужные`);
    }
    const attrs = await this.checkAttrs(input.categoryId, input.attrs);
    const q = input.q?.trim() || null;
    const maxPrice = input.maxPrice ?? null;
    await this.assertUnique(userId, {
      categoryId: input.categoryId,
      attrs,
      q,
      maxPrice: maxPrice?.toString() ?? null,
    });
    const row = await this.prisma.savedSearch.create({
      data: {
        userId,
        categoryId: input.categoryId,
        attrs,
        q,
        maxPrice: maxPrice != null ? BigInt(maxPrice) : null,
        notify: input.notify ?? true,
      },
      select: SELECT,
    });
    return this.view(row);
  }

  /**
   * Уведомления и «цена до». Новая цена или включённые уведомления считают
   * новыми лоты с этого момента: старые предложения не приходят пачкой.
   */
  async update(userId: string, id: string, patch: { notify?: boolean; maxPrice?: number | null }) {
    const row = await this.prisma.savedSearch.findFirst({
      where: { id, userId },
      select: { categoryId: true, attrs: true, q: true, maxPrice: true, notify: true },
    });
    if (!row) throw new NotFoundException('Поиск не найден');
    const priceChanged =
      patch.maxPrice !== undefined &&
      (patch.maxPrice?.toString() ?? null) !== (row.maxPrice?.toString() ?? null);
    if (priceChanged) {
      await this.assertUnique(
        userId,
        {
          categoryId: row.categoryId,
          attrs: searchAttrs(row.attrs),
          q: row.q,
          maxPrice: patch.maxPrice?.toString() ?? null,
        },
        id,
      );
    }
    const turnedOn = patch.notify === true && !row.notify;
    const updated = await this.prisma.savedSearch.update({
      where: { id },
      data: {
        ...(patch.notify !== undefined ? { notify: patch.notify } : {}),
        ...(priceChanged
          ? { maxPrice: patch.maxPrice != null ? BigInt(patch.maxPrice) : null }
          : {}),
        ...(priceChanged || turnedOn ? { since: new Date() } : {}),
      },
      select: SELECT,
    });
    return this.view(updated);
  }

  async remove(userId: string, id: string) {
    const r = await this.prisma.savedSearch.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Поиск не найден');
    return { ok: true };
  }

  /** Проход по поискам с уведомлениями; сбой одного не мешает остальным. */
  @Interval('saved-searches', SWEEP_MS)
  async sweep(): Promise<{ searches: number; notified: number }> {
    if (this.running) return { searches: 0, notified: 0 };
    this.running = true;
    try {
      const searches = await this.prisma.savedSearch.findMany({
        where: { notify: true, user: { status: 'active' } },
        select: {
          id: true,
          userId: true,
          categoryId: true,
          attrs: true,
          q: true,
          maxPrice: true,
          since: true,
          category: { select: { slug: true, game: { select: { slug: true } } } },
          user: { select: { locale: true } },
        },
      });
      let notified = 0;
      for (const s of searches) {
        try {
          if (await this.check(s)) notified++;
        } catch (e) {
          this.logger.warn(`Поиск ${s.id}: ${(e as Error).message}`);
        }
      }
      return { searches: searches.length, notified };
    } finally {
      this.running = false;
    }
  }

  private async check(s: {
    id: string;
    userId: string;
    categoryId: string;
    attrs: unknown;
    q: string | null;
    maxPrice: bigint | null;
    since: Date;
    category: { slug: string; game: { slug: string } | null };
    user: { locale: string | null };
  }): Promise<boolean> {
    const game = s.category.game;
    const attrs = searchAttrs(s.attrs);
    const found = await this.prisma.listing.findMany({
      where: {
        ...listingFilters({ attrs, q: s.q, maxPrice: s.maxPrice }),
        status: 'active',
        categoryId: s.categoryId,
        createdAt: { gte: s.since },
        sellerId: { not: s.userId },
        // Чёрный список в обе стороны: заблокировавший не продаст, а
        // заблокированного покупатель видеть не хочет.
        seller: {
          blocksMade: { none: { blockedId: s.userId } },
          blocksReceived: { none: { blockerId: s.userId } },
        },
        searchHits: { none: { searchId: s.id } },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true, title: true, price: true },
    });
    if (!found.length) return false;
    // Отметка «прислано» — до уведомления: второй экземпляр API, нашедший
    // те же лоты, ничего не вставит и промолчит.
    const { count } = await this.prisma.savedSearchHit.createMany({
      data: found.map((l) => ({ searchId: s.id, listingId: l.id })),
      skipDuplicates: true,
    });
    if (!count) return false;
    await this.prisma.savedSearch.update({ where: { id: s.id }, data: { lastHitAt: new Date() } });

    const lang = langOf(s.user.locale);
    const first = found[0]!;
    const price = `${(Number(first.price) / 100).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')} ₽`;
    const preview =
      found.length > 1
        ? say(lang, '«{title}» — {price} и ещё {n}', {
            title: first.title,
            price,
            n: found.length - 1,
          })
        : say(lang, '«{title}» — {price}', { title: first.title, price });
    await this.notifications.notify(s.userId, 'saved_search', {
      searchId: s.id,
      count: found.length,
      preview,
      ...(found.length === 1 ? { listingId: first.id } : {}),
      path: game
        ? searchPath(game.slug, s.category.slug, {
            attrs,
            q: s.q,
            maxPrice: s.maxPrice?.toString() ?? null,
          })
        : '/cabinet/searches',
    });
    return true;
  }
}
