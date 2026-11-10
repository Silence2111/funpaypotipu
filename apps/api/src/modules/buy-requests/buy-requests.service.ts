import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, PrismaClient } from '@gamemarket/db';
import {
  BUY_REQUEST_NOTIFY_LIMIT,
  BUY_REQUEST_SELLER_ACTIVE_DAYS,
  MAX_BUY_REQUESTS_PER_DAY,
  MAX_OFFERS_PER_SELLER,
  MAX_OPEN_BUY_REQUESTS,
  buyRequestExpiry,
  buyRequestState,
  maskContacts,
  withinBudget,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { AccountStatusService } from '../access/account-status.service';
import { BlocksService } from '../access/blocks.service';
import { langOf, say } from '../../i18n/texts';
import type { Lang } from '../../i18n/lang';

/** Рассылка продавцам — сразу после создания; проход подбирает упавшие. */
const SWEEP_MS = Number(process.env.BUY_REQUEST_INTERVAL_MS ?? 60_000);

export interface RequestInput {
  categoryId: string;
  text: string;
  /** Минорные единицы; null — без предела. */
  maxPrice?: number | null;
}

const rub = (lang: Lang, minor: bigint | number | string) =>
  `${(Number(minor) / 100).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')} ₽`;

const CATEGORY = {
  select: { id: true, slug: true, title: true, game: { select: { slug: true, title: true } } },
} as const;

/** Открыт и не истёк — его видят продавцы и на него можно ответить. */
const live = (now = new Date()): Prisma.BuyRequestWhereInput => ({ status: 'open', expiresAt: { gt: now } });

/**
 * Запросы покупателей «Хочу купить»: покупатель пишет в разделе, что ищет и
 * до какой цены; продавцам раздела — уведомление на сайте, пушем и в
 * Telegram; продавец отвечает своим лотом, покупателю приходит ссылка на
 * лот. Контакты в тексте скрываются, как в чате; чёрный список действует в
 * обе стороны; у человека — не больше пяти открытых запросов.
 */
@Injectable()
export class BuyRequestsService {
  private readonly logger = new Logger(BuyRequestsService.name);
  private running = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly status: AccountStatusService,
    private readonly blocks: BlocksService,
  ) {}

  // ── Покупатель ──

  async create(userId: string, input: RequestInput) {
    await this.status.assertCanTrade(userId);
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, isActive: true, game: { isActive: true } },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Раздел не найден');

    const now = new Date();
    const [open, today] = await Promise.all([
      this.prisma.buyRequest.count({ where: { buyerId: userId, ...live(now) } }),
      this.prisma.buyRequest.count({
        where: { buyerId: userId, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
      }),
    ]);
    if (open >= MAX_OPEN_BUY_REQUESTS) {
      throw new BadRequestException(`Не больше ${MAX_OPEN_BUY_REQUESTS} открытых запросов — закройте найденные`);
    }
    if (today >= MAX_BUY_REQUESTS_PER_DAY) {
      throw new BadRequestException(`Не больше ${MAX_BUY_REQUESTS_PER_DAY} запросов в сутки`);
    }
    // Контакты — как в чате: запрос не уводит сделку мимо площадки.
    const text = maskContacts(input.text.trim().replace(/\s+/g, ' ')).masked;
    const same = await this.prisma.buyRequest.findFirst({
      where: { buyerId: userId, categoryId: category.id, text, ...live(now) },
      select: { id: true },
    });
    if (same) throw new ConflictException('Такой запрос в разделе уже открыт');

    const row = await this.prisma.buyRequest.create({
      data: {
        buyerId: userId,
        categoryId: category.id,
        text,
        maxPrice: input.maxPrice != null ? BigInt(input.maxPrice) : null,
        expiresAt: buyRequestExpiry(now),
      },
      select: { id: true },
    });
    // Продавцам — сразу; сбой рассылки не ломает создание: проход повторит.
    void this.fanOut(row.id).catch((e) => this.logger.warn(`Запрос ${row.id}: ${(e as Error).message}`));
    return this.one(row.id, userId);
  }

  async close(userId: string, id: string) {
    const r = await this.prisma.buyRequest.updateMany({
      where: { id, buyerId: userId, status: 'open' },
      data: { status: 'closed', closedAt: new Date() },
    });
    if (!r.count) throw new NotFoundException('Запрос не найден');
    return this.one(id, userId);
  }

  /** «Мои запросы»: все, свежие сверху, с лотами, которыми ответили продавцы. */
  async mine(userId: string) {
    const rows = await this.prisma.buyRequest.findMany({
      where: { buyerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.one(r.id, userId)));
  }

  /** Запрос для его автора — с ответами продавцов. */
  private async one(id: string, userId: string) {
    const r = await this.prisma.buyRequest.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        buyerId: true,
        text: true,
        maxPrice: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        closedAt: true,
        notifiedCount: true,
        category: CATEGORY,
        offers: {
          orderBy: { createdAt: 'desc' },
          select: {
            createdAt: true,
            listing: {
              select: {
                id: true,
                title: true,
                price: true,
                currency: true,
                status: true,
                seller: { select: { profile: { select: { username: true, ratingAvg: true, ratingCount: true } } } },
              },
            },
          },
        },
      },
    });
    if (r.buyerId !== userId) throw new NotFoundException('Запрос не найден');
    return {
      id: r.id,
      text: r.text,
      maxPrice: r.maxPrice?.toString() ?? null,
      state: buyRequestState(r),
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      closedAt: r.closedAt,
      // Скольким продавцам раздела ушло уведомление.
      notified: r.notifiedCount,
      category: { slug: r.category.slug, title: r.category.title },
      game: r.category.game,
      offers: r.offers.map((o) => ({
        at: o.createdAt,
        listing: {
          id: o.listing.id,
          title: o.listing.title,
          price: o.listing.price.toString(),
          currency: o.listing.currency,
          // Лот сняли или продали — покупатель видит, что он уже не в продаже.
          active: o.listing.status === 'active',
          withinBudget: withinBudget(o.listing.price, r.maxPrice),
          seller: o.listing.seller.profile,
        },
      })),
    };
  }

  // ── Раздел ──

  /** Открытые запросы раздела — всем, без входа: спрос виден до первого лота. */
  async inCategory(categoryId: string, limit = 20) {
    const where: Prisma.BuyRequestWhereInput = {
      categoryId,
      ...live(),
      buyer: { status: 'active' },
    };
    const [items, total] = await Promise.all([
      this.prisma.buyRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          text: true,
          maxPrice: true,
          createdAt: true,
          expiresAt: true,
          buyer: { select: { id: true, profile: { select: { username: true } } } },
          _count: { select: { offers: true } },
        },
      }),
      this.prisma.buyRequest.count({ where }),
    ]);
    return {
      total,
      items: items.map((r) => ({
        id: r.id,
        text: r.text,
        maxPrice: r.maxPrice?.toString() ?? null,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        buyer: { id: r.buyer.id, username: r.buyer.profile?.username ?? null },
        offers: r._count.offers,
      })),
    };
  }

  // ── Продавец ──

  /**
   * Запросы для продавца: в разделах, где у него лоты в продаже, или во
   * всех — у нового продавца лотов ещё нет. Свои и от тех, кто в чёрном
   * списке, — нет. Запрос из уведомления (`highlight`) — первым, даже если
   * лот в разделе уже снят.
   */
  async forSeller(userId: string, scope: 'mine' | 'all', highlight?: string) {
    const lots = await this.prisma.listing.findMany({
      where: { sellerId: userId, status: 'active' },
      distinct: ['categoryId'],
      select: { categoryId: true },
    });
    const categoryIds = lots.map((l) => l.categoryId);
    const base: Prisma.BuyRequestWhereInput = {
      ...live(),
      buyerId: { not: userId },
      buyer: {
        status: 'active',
        blocksMade: { none: { blockedId: userId } },
        blocksReceived: { none: { blockerId: userId } },
      },
    };
    const where: Prisma.BuyRequestWhereInput =
      scope === 'mine' ? { ...base, categoryId: { in: categoryIds } } : base;
    const select = {
      id: true,
      text: true,
      maxPrice: true,
      createdAt: true,
      expiresAt: true,
      categoryId: true,
      category: CATEGORY,
      buyer: { select: { profile: { select: { username: true } } } },
      _count: { select: { offers: true } },
      offers: { where: { sellerId: userId }, select: { listingId: true } },
    } satisfies Prisma.BuyRequestSelect;
    const [rows, total, top] = await Promise.all([
      this.prisma.buyRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50, select }),
      this.prisma.buyRequest.count({ where }),
      highlight ? this.prisma.buyRequest.findFirst({ where: { ...base, id: highlight }, select }) : null,
    ]);
    const list = top ? [top, ...rows.filter((r) => r.id !== top.id)] : rows;
    return {
      scope,
      // Разделов, где продавец сейчас продаёт: ноль — сайт предлагает «Все разделы».
      sellingIn: categoryIds.length,
      total,
      items: list.map((r) => ({
        id: r.id,
        text: r.text,
        maxPrice: r.maxPrice?.toString() ?? null,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        category: { id: r.categoryId, slug: r.category.slug, title: r.category.title },
        game: r.category.game,
        buyer: r.buyer.profile?.username ?? null,
        offers: r._count.offers,
        myOffers: r.offers.map((o) => o.listingId),
      })),
    };
  }

  /** Чем продавец может ответить: его лоты в продаже в разделе запроса. */
  async candidates(userId: string, requestId: string) {
    const r = await this.liveFor(userId, requestId);
    const [lots, mine] = await Promise.all([
      this.prisma.listing.findMany({
        where: { sellerId: userId, status: 'active', categoryId: r.categoryId },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: { id: true, title: true, price: true, currency: true },
      }),
      this.prisma.buyRequestOffer.findMany({ where: { requestId, sellerId: userId }, select: { listingId: true } }),
    ]);
    const offered = new Set(mine.map((o) => o.listingId));
    return {
      maxPrice: r.maxPrice?.toString() ?? null,
      left: Math.max(0, MAX_OFFERS_PER_SELLER - offered.size),
      items: lots.map((l) => ({
        id: l.id,
        title: l.title,
        price: l.price.toString(),
        currency: l.currency,
        offered: offered.has(l.id),
        withinBudget: withinBudget(l.price, r.maxPrice),
      })),
    };
  }

  /** Ответ лотом: покупателю — уведомление со ссылкой на лот. */
  async offer(userId: string, requestId: string, listingId: string) {
    await this.status.assertCanTrade(userId);
    const r = await this.liveFor(userId, requestId);
    await this.blocks.assertCanContact(userId, r.buyerId, 'message');
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, sellerId: userId },
      select: { id: true, title: true, price: true, status: true, categoryId: true },
    });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.status !== 'active') throw new BadRequestException('Предложить можно только лот в продаже');
    if (listing.categoryId !== r.categoryId) throw new BadRequestException('Лот — из другого раздела');
    const mine = await this.prisma.buyRequestOffer.count({ where: { requestId, sellerId: userId } });
    if (mine >= MAX_OFFERS_PER_SELLER) {
      throw new BadRequestException(`На один запрос — не больше ${MAX_OFFERS_PER_SELLER} лотов`);
    }
    try {
      await this.prisma.buyRequestOffer.create({ data: { requestId, sellerId: userId, listingId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Этот лот уже предложен');
      }
      throw e;
    }
    const buyer = await this.prisma.user.findUnique({ where: { id: r.buyerId }, select: { locale: true } });
    const seller = await this.prisma.profile.findUnique({ where: { userId }, select: { username: true } });
    const lang = langOf(buyer?.locale);
    await this.notifications.notify(r.buyerId, 'buy_request_offer', {
      requestId,
      listingId,
      preview: say(lang, '«{title}» — {price}, продавец {seller}', {
        title: listing.title,
        price: rub(lang, listing.price),
        seller: seller?.username ?? '',
      }),
    });
    return { ok: true, listingId };
  }

  /** Открытый чужой запрос — иначе отвечать не на что. */
  private async liveFor(userId: string, requestId: string) {
    const r = await this.prisma.buyRequest.findFirst({
      where: { id: requestId, ...live(), buyer: { status: 'active' } },
      select: { buyerId: true, categoryId: true, maxPrice: true },
    });
    if (!r) throw new NotFoundException('Запрос закрыт или истёк');
    if (r.buyerId === userId) throw new BadRequestException('Это ваш запрос');
    return r;
  }

  // ── Рассылка продавцам раздела ──

  /** Запросы, которым рассылка не ушла: упал API или рассылка не дошла. */
  @Interval('buy-requests', SWEEP_MS)
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const rows = await this.prisma.buyRequest.findMany({
        where: { ...live(), notifiedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { id: true },
      });
      let sent = 0;
      for (const r of rows) {
        try {
          sent += await this.fanOut(r.id);
        } catch (e) {
          this.logger.warn(`Запрос ${r.id}: ${(e as Error).message}`);
        }
      }
      return sent;
    } finally {
      this.running = false;
    }
  }

  /**
   * Продавцы раздела — с лотом в продаже и заходившие за 30 дней, первыми —
   * кто был недавно. Отметка — до рассылки: второй экземпляр API ничего не
   * разошлёт. Возвращает, скольким ушло.
   */
  async fanOut(id: string): Promise<number> {
    const claimed = await this.prisma.buyRequest.updateMany({
      where: { id, notifiedAt: null, ...live() },
      data: { notifiedAt: new Date() },
    });
    if (!claimed.count) return 0;
    const r = await this.prisma.buyRequest.findUniqueOrThrow({
      where: { id },
      select: { buyerId: true, categoryId: true, text: true, maxPrice: true, category: CATEGORY },
    });
    const since = new Date(Date.now() - BUY_REQUEST_SELLER_ACTIVE_DAYS * 24 * 3600_000);
    const sellers = await this.prisma.user.findMany({
      where: {
        id: { not: r.buyerId },
        status: 'active',
        listings: { some: { categoryId: r.categoryId, status: 'active' } },
        profile: { onlineAt: { gte: since } },
        blocksMade: { none: { blockedId: r.buyerId } },
        blocksReceived: { none: { blockerId: r.buyerId } },
      },
      orderBy: { profile: { onlineAt: 'desc' } },
      take: BUY_REQUEST_NOTIFY_LIMIT,
      select: { id: true, locale: true },
    });
    let sent = 0;
    for (const s of sellers) {
      const lang = langOf(s.locale);
      // Названия раздела и игры — данные каталога, как на сайте до перевода.
      const where = `${r.category.title} ${r.category.game?.title ?? ''}`.trim();
      try {
        await this.notifications.notify(s.id, 'buy_request', {
          requestId: id,
          preview:
            r.maxPrice != null
              ? say(lang, '{where}: «{text}» — до {price}', { where, text: r.text, price: rub(lang, r.maxPrice) })
              : say(lang, '{where}: «{text}»', { where, text: r.text }),
        });
        sent++;
      } catch (e) {
        this.logger.warn(`Запрос ${id}, продавец ${s.id}: ${(e as Error).message}`);
      }
    }
    await this.prisma.buyRequest.update({ where: { id }, data: { notifiedCount: sent } });
    return sent;
  }
}
