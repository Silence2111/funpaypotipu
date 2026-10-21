import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type FulfillmentType } from '@gamemarket/db';
import {
  SALE_MIN_PRICE,
  bumpCooldownHours,
  chargeFromBalance,
  maskContacts,
  promoCost,
  promoUntil,
  qtyTermsError,
  salePrice,
  topupQuote,
  topupTermsError,
  type CreateListingInput,
  type ListingQuery,
  type TopupTerms,
  type TopupTermsInput,
  type UpdateListingInput,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { SearchService } from '../search/search.service';
import { StorageService } from '../storage/storage.service';
import { LedgerService } from '../ledger/ledger.service';
import { assetUrl } from '../storage/asset-url';
import { ONLINE_MS } from '../../common/presence';

const BOOST_MS = 24 * 3600 * 1000; // лот держится в топе сутки
/** Как часто проверять автоподнятие: лот поднимется не позже чем через столько после конца паузы. */
const AUTO_RAISE_MS = Number(process.env.AUTO_RAISE_INTERVAL_MS ?? 5 * 60_000);
/** Как часто возвращать цену лотам, у которых кончилась скидка. В CI — чаще. */
const SALE_SWEEP_MS = Number(process.env.SALE_SWEEP_INTERVAL_MS ?? 60_000);
// Цена суток продвижения, копейки. Решение площадки (ПЛАН.md), не код.
export const PROMO_DAY_PRICE = BigInt(process.env.PROMO_DAY_PRICE ?? 9_900);

/** Кулдаун поднятия по заслугам: чем больше продаж, тем чаще (как на FunPay). */
const bumpCooldownMs = (sales: number) => bumpCooldownHours(sales) * 3600 * 1000;

/** Общая пачка раздела валюты («за 1 000 золота») или null, если её нет. */
const sectionPack = (c: { unitName: string | null; pricePerUnits: number | null }) =>
  c.unitName && c.pricePerUnits ? { unitName: c.unitName, pricePerUnits: c.pricePerUnits } : null;

/**
 * Автовыдача у аккаунтов, предметов и услуг: одна строка склада — одна
 * штука. Покупатель берёт сколько нужно, наличие считает склад.
 */
const PER_LINE = { unitName: null, pricePerUnits: 1, minQty: 1, stock: 0 };

const formatUnits = (n: number, unit: string) => `${new Intl.NumberFormat('ru-RU').format(n)} ${unit}`;

/** Сколько ждать до следующего поднятия лота; 0 — можно сейчас. */
const bumpWaitMs = (boostUntil: Date | null, cooldownMs: number, now: number) =>
  boostUntil ? Math.max(0, boostUntil.getTime() - BOOST_MS + cooldownMs - now) : 0;

const cardSelect = {
  id: true,
  title: true,
  price: true,
  currency: true,
  images: true,
  status: true,
  createdAt: true,
  boostUntil: true,
  // Платное продвижение: карточка помечает его, выдача ставит выше.
  promotedUntil: true,
  // Скидка: карточка зачёркивает прежнюю цену и пишет «−20%».
  saleListPrice: true,
  saleUntil: true,
  fulfillmentType: true,
  // Лот «на сумму покупателя»: карточка пишет «от», страница лота — форму суммы.
  topupMarkupBps: true,
  topupMin: true,
  topupMax: true,
  // Поштучно: карточка пишет «15 ₽ за 1000 золота» и наличие.
  unitName: true,
  pricePerUnits: true,
  minQty: true,
  stock: true,
  // Параметры раздела (звание, регион, сервер) — колонки таблицы раздела.
  attributes: true,
  // Продавец в строке раздела, как на FunPay: имя, аватар, рейтинг с числом
  // отзывов и «в сети». Без него выдача — список цен без людей.
  seller: {
    select: {
      id: true,
      profile: {
        select: {
          username: true,
          displayName: true,
          avatarUrl: true,
          ratingAvg: true,
          ratingCount: true,
          onlineAt: true,
        },
      },
    },
  },
  category: { select: { id: true, slug: true, title: true } },
  game: { select: { slug: true, title: true } },
} satisfies Prisma.ListingSelect;

/**
 * Условия раздела, общие для выдачи и сохранённых поисков: параметры, текст
 * в названии, цена. Что пришло уведомлением о поиске — то и видно в разделе.
 */
export function listingFilters(f: {
  attrs?: Record<string, string | boolean>;
  q?: string | null;
  minPrice?: number | bigint | null;
  maxPrice?: number | bigint | null;
}): Prisma.ListingWhereInput {
  const where: Prisma.ListingWhereInput = {};
  // Фасетные фильтры по атрибутам (JSON-путь в Postgres).
  if (f.attrs && Object.keys(f.attrs).length) {
    where.AND = Object.entries(f.attrs).map(([k, v]) => ({
      attributes: { path: [k], equals: v },
    }));
  }
  if (f.q) where.title = { contains: f.q, mode: 'insensitive' };
  if (f.minPrice != null || f.maxPrice != null) {
    where.price = {
      gte: f.minPrice != null ? BigInt(f.minPrice) : undefined,
      lte: f.maxPrice != null ? BigInt(f.maxPrice) : undefined,
    };
  }
  return where;
}

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly search: SearchService,
    private readonly storage: StorageService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Продвижение с баланса: лот выше в своём разделе на оплаченный срок.
   * Списание и новый срок — одной транзакцией, баланс не уходит в минус.
   */
  async promote(sellerId: string, listingId: string, days: number) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true, status: true, currency: true, promotedUntil: true, title: true },
    });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш лот');
    if (listing.status !== 'active') throw new BadRequestException('Продвигать можно только лот в продаже');

    const cost = promoCost(PROMO_DAY_PRICE, days);
    const balance = await this.ledger.balanceOf(sellerId, listing.currency);
    if (balance < cost) {
      throw new BadRequestException(`На балансе не хватает ${((Number(cost - balance)) / 100).toLocaleString('ru-RU')} ₽ — пополните баланс`);
    }
    const until = promoUntil(listing.promotedUntil, days);
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.post(
        {
          legs: chargeFromBalance(sellerId, cost),
          currency: listing.currency,
          idempotencyKey: `promotion:${listingId}:${randomUUID()}`,
          refType: 'promotion',
          refId: listingId,
        },
        tx,
      );
      await this.ledger.assertNotOverdrawn(tx, sellerId, listing.currency);
      await tx.listing.update({ where: { id: listingId }, data: { promotedUntil: until } });
    });
    return { promotedUntil: until, charged: cost.toString() };
  }

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

  /** Ключи хранилища → адреса для показа: фото лота и аватар продавца. */
  private resolveImages<T extends { images: unknown; seller?: unknown }>(row: T): T {
    const imgs = Array.isArray(row.images) ? (row.images as string[]) : [];
    const out = { ...row, images: imgs.map((k) => assetUrl(k)) };
    const seller = row.seller as { profile?: { avatarUrl?: string | null } | null } | undefined;
    if (seller?.profile?.avatarUrl) {
      const profile = { ...seller.profile, avatarUrl: assetUrl(seller.profile.avatarUrl) };
      out.seller = { ...seller, profile } as T['seller'];
    }
    return out;
  }

  /**
   * Фильтр по параметрам: {"rank":"Global Elite","prime":true}. Параметр
   * «да/нет» лежит в лоте булевым, поэтому и в фильтре он булев: строка
   * "true" с ним не совпала бы.
   */
  private parseAttrs(raw?: string): Record<string, string | boolean> | undefined {
    if (!raw) return undefined;
    try {
      const o: unknown = JSON.parse(raw);
      if (!o || typeof o !== 'object') return undefined;
      const out: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (!/^[a-z0-9_]{1,40}$/i.test(k)) continue;
        if ((typeof v === 'string' && v) || typeof v === 'boolean') out[k] = v;
      }
      return Object.keys(out).length ? out : undefined;
    } catch {
      return undefined;
    }
  }

  async browse(query: ListingQuery) {
    const attrs = this.parseAttrs(query.attrs);
    // Текстовый запрос + доступный движок → релевантный поиск с typo-tolerance.
    // При фильтре по продавцу/атрибутам идём в Postgres (в Meili они не индексируются).
    if (query.q && this.search.enabled && !query.sellerId && !attrs && !query.instant && !query.online && !query.segment) {
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
        // Индекс может отставать от статуса: распроданный при оплате лот
        // ещё лежит в нём как активный. Статус проверяем по базе.
        const rows = await this.prisma.listing.findMany({
          where: { id: { in: found.ids }, status: 'active' },
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
    if (query.sellerId) where.sellerId = query.sellerId;
    if (query.instant) where.fulfillmentType = { in: ['auto_key', 'provider'] };
    // Онлайн — тот же порог, что у зелёной точки на карточке: 5 минут.
    if (query.online) where.seller = { profile: { onlineAt: { gte: new Date(Date.now() - ONLINE_MS) } } };
    if (query.gameSlug) where.game = { slug: query.gameSlug };
    if (query.categorySlug || query.segment) {
      where.category = {
        ...(query.categorySlug ? { slug: query.categorySlug } : {}),
        ...(query.segment ? { segment: query.segment } : {}),
      };
    }
    Object.assign(
      where,
      listingFilters({ attrs, q: query.q, minPrice: query.minPrice, maxPrice: query.maxPrice }),
    );

    // По умолчанию поднятые лоты (boostUntil) держатся выше — как «поднятие» на FunPay.
    const orderBy: Prisma.ListingOrderByWithRelationInput[] =
      query.sort === 'price_asc'
        ? [{ price: 'asc' }]
        : query.sort === 'price_desc'
          ? [{ price: 'desc' }]
          : query.sort === 'popular'
            ? [{ salesCount: 'desc' }, { createdAt: 'desc' }]
            : [
                // Оплаченное продвижение — выше всех; истёкшее обнуляет фоновая задача.
                { promotedUntil: { sort: 'desc', nulls: 'last' } },
                { boostUntil: { sort: 'desc', nulls: 'last' } },
                { createdAt: 'desc' },
              ];

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
        buyerFields: true,
        fulfillmentType: true,
        salesCount: true,
        // id раздела — странице лота: по нему подписи параметров («Звание»,
        // а не «rank») и похожие предложения. Выдача раздела — чтобы
        // автовыдачу аккаунта не называть ключом.
        category: { select: { id: true, slug: true, title: true, fulfillmentType: true } },
        seller: {
          select: {
            id: true,
            profile: { select: { username: true, ratingAvg: true, ratingCount: true } },
          },
        },
      },
    });
    // Распроданный лот открывается по ссылке из избранного и заказов с
    // пометкой «закончился»: 404 выглядел бы как удалённый лот.
    if (!listing || (listing.status !== 'active' && listing.status !== 'sold_out')) {
      throw new NotFoundException('Лот не найден');
    }
    return this.resolveImages(listing);
  }

  async listMine(sellerId: string) {
    const rows = await this.prisma.listing.findMany({
      where: { sellerId, status: { not: 'archived' } },
      orderBy: { createdAt: 'desc' },
      select: { ...cardSelect, categoryId: true, pausedForAway: true },
    });
    return rows.map((r) => this.resolveImages(r));
  }

  /**
   * Свой лот для формы изменения: в любом статусе, кроме архива. Публичный
   * `getById` отдаёт только активные лоты — снятый с продажи лот продавец
   * иначе не мог бы даже открыть. Ключи фото отдаются как сохранены, чтобы
   * форма вернула их без изменений.
   */
  async getMine(sellerId: string, id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: {
        ...cardSelect,
        sellerId: true,
        gameId: true,
        categoryId: true,
        description: true,
        attributes: true,
        buyerFields: true,
        stock: true,
        deliveryTemplate: true,
        category: { select: { slug: true, title: true, fulfillmentType: true, unitName: true, pricePerUnits: true } },
      },
    });
    if (!listing || listing.status === 'archived') throw new NotFoundException('Лот не найден');
    if (listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш лот');
    const imageKeys = Array.isArray(listing.images) ? (listing.images as string[]) : [];
    return { ...this.resolveImages(listing), imageKeys };
  }

  /** Поднять лот в топ. Кулдаун merit-based: чем больше продаж — тем чаще (как на FunPay). */
  async bump(sellerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true, status: true, boostUntil: true },
    });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш лот');
    if (listing.status !== 'active') throw new BadRequestException('Поднять можно только активный лот');

    const profile = await this.prisma.profile.findUnique({
      where: { userId: sellerId },
      select: { salesCount: true },
    });
    const now = Date.now();
    const wait = bumpWaitMs(listing.boostUntil, bumpCooldownMs(profile?.salesCount ?? 0), now);
    if (wait > 0) throw new BadRequestException(`Поднять можно через ${Math.ceil(wait / 60000)} мин`);

    const boostUntil = new Date(now + BOOST_MS);
    await this.prisma.listing.update({ where: { id: listingId }, data: { boostUntil } });
    return { boostUntil };
  }

  /**
   * Поднять все активные лоты раздела разом — как «Поднять предложения» на
   * FunPay. У каждого лота свой кулдаун: поднимаются те, чей срок прошёл,
   * остальные ждут, и ответ говорит, через сколько можно следующим.
   */
  async bumpAll(sellerId: string, only: { categoryId?: string; ids?: string[] } = {}) {
    const [listings, profile] = await Promise.all([
      this.prisma.listing.findMany({
        where: {
          sellerId,
          status: 'active',
          ...(only.categoryId ? { categoryId: only.categoryId } : {}),
          ...(only.ids ? { id: { in: only.ids } } : {}),
        },
        select: { id: true, boostUntil: true },
      }),
      this.prisma.profile.findUnique({ where: { userId: sellerId }, select: { salesCount: true } }),
    ]);
    const cooldownMs = bumpCooldownMs(profile?.salesCount ?? 0);
    const now = Date.now();
    const ready: string[] = [];
    const waits: number[] = [];
    for (const l of listings) {
      const wait = bumpWaitMs(l.boostUntil, cooldownMs, now);
      if (wait > 0) waits.push(wait);
      else ready.push(l.id);
    }
    if (ready.length) {
      await this.prisma.listing.updateMany({
        where: { id: { in: ready } },
        data: { boostUntil: new Date(now + BOOST_MS) },
      });
    }
    return {
      bumped: ready.length,
      waiting: waits.length,
      nextInMinutes: waits.length ? Math.ceil(Math.min(...waits) / 60000) : null,
    };
  }

  /**
   * Автоподнятие — то, ради чего продавцы FunPay ставят бота: лоты
   * поднимаются сами, как только проходит пауза. Пауза та же, что у кнопки,
   * по заслугам, — автоподнятие избавляет только от нажатия каждые 4 часа.
   * В отпуске и у замороженных или заблокированных аккаунтов не поднимает.
   */
  /**
   * Временная скидка: цена ниже на pct процентов на days суток, прежняя —
   * отдельно. Одна скидка за раз; цена меняется условно — два нажатия не
   * снизят её дважды. Лоту «на сумму покупателя» скидка — это наценка.
   */
  async startSale(sellerId: string, id: string, pct: number, days: number) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { sellerId: true, status: true, price: true, topupMarkupBps: true, saleUntil: true },
    });
    if (!listing || listing.status === 'archived') throw new NotFoundException('Лот не найден');
    if (listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш лот');
    if (listing.status !== 'active' && listing.status !== 'sold_out') {
      throw new BadRequestException('Скидку можно дать лоту в продаже');
    }
    if (listing.topupMarkupBps != null) {
      throw new BadRequestException('У пополнения скидка — это наценка: измените её в лоте');
    }
    if (listing.saleUntil) {
      throw new BadRequestException('Скидка уже идёт — завершите её, чтобы начать новую');
    }
    const price = salePrice(listing.price, pct);
    if (price < SALE_MIN_PRICE) throw new BadRequestException('Со скидкой цена меньше 1 ₽');
    const saleUntil = new Date(Date.now() + days * 24 * 3600_000);
    const r = await this.prisma.listing.updateMany({
      where: { id, sellerId, saleUntil: null, price: listing.price },
      data: { saleListPrice: listing.price, price, saleUntil },
    });
    if (!r.count) throw new BadRequestException('Лот только что изменился — обновите страницу');
    await this.search.indexListing(id);
    return { price: price.toString(), saleListPrice: listing.price.toString(), saleUntil };
  }

  /** Завершить скидку раньше срока: прежняя цена возвращается сразу. */
  async endSale(sellerId: string, id: string) {
    const n = await this.prisma.$executeRaw`
      UPDATE listings
      SET price = sale_list_price, sale_list_price = NULL, sale_until = NULL, updated_at = ${new Date()}
      WHERE id = ${id}::uuid AND seller_id = ${sellerId}::uuid AND sale_until IS NOT NULL`;
    if (!n) throw new NotFoundException('Скидки на этом лоте нет');
    await this.search.indexListing(id);
    return { ok: true };
  }

  /** Срок скидки вышел — прежняя цена возвращается одним запросом. */
  @Interval('sales', SALE_SWEEP_MS)
  async endExpiredSales(): Promise<number> {
    const now = new Date();
    const ended = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE listings
      SET price = sale_list_price, sale_list_price = NULL, sale_until = NULL, updated_at = ${now}
      WHERE sale_until IS NOT NULL AND sale_until <= ${now}
      RETURNING id`;
    for (const { id } of ended) {
      await this.search.indexListing(id).catch((e: Error) => this.logger.warn(`Индекс ${id}: ${e.message}`));
    }
    return ended.length;
  }

  @Interval('auto-raise', AUTO_RAISE_MS)
  async autoRaise() {
    const sellers = await this.prisma.profile.findMany({
      where: { autoRaise: true, awaySince: null, user: { status: 'active' } },
      select: { userId: true },
    });
    let bumped = 0;
    for (const s of sellers) {
      try {
        bumped += (await this.bumpAll(s.userId)).bumped;
      } catch (e) {
        this.logger.warn(`Автоподнятие ${s.userId}: ${(e as Error).message}`);
      }
    }
    return { sellers: sellers.length, bumped };
  }

  /** Для настроек автоподнятия: пауза продавца и когда поднимется следующий лот. */
  async raiseStatus(sellerId: string) {
    const [listings, profile] = await Promise.all([
      this.prisma.listing.findMany({
        where: { sellerId, status: 'active' },
        select: { boostUntil: true },
      }),
      this.prisma.profile.findUnique({ where: { userId: sellerId }, select: { salesCount: true } }),
    ]);
    const everyHours = bumpCooldownHours(profile?.salesCount ?? 0);
    const now = Date.now();
    const waits = listings.map((l) => bumpWaitMs(l.boostUntil, everyHours * 3600 * 1000, now));
    return {
      everyHours,
      activeLots: listings.length,
      nextInMinutes: waits.length ? Math.ceil(Math.min(...waits) / 60000) : null,
    };
  }

  /**
   * Действие над выбранными лотами — галочки в «Моих предложениях» FunPay.
   * Лоты не в том статусе пропускаются: снять можно продающийся, вернуть —
   * снятый и с наличием. Заблокированный модератором не трогается.
   */
  async bulk(sellerId: string, ids: string[], action: 'pause' | 'activate' | 'bump') {
    if (action === 'bump') {
      const r = await this.bumpAll(sellerId, { ids });
      return { done: r.bumped, skipped: ids.length - r.bumped - r.waiting, ...r };
    }
    const where: Prisma.ListingWhereInput =
      action === 'pause'
        ? { id: { in: ids }, sellerId, status: 'active' }
        : { id: { in: ids }, sellerId, status: { in: ['paused', 'draft'] }, OR: [{ stock: null }, { stock: { gt: 0 } }] };
    const found = await this.prisma.listing.findMany({ where, select: { id: true } });
    const changed = found.length
      ? await this.prisma.listing.updateMany({
          where: { ...where, id: { in: found.map((l) => l.id) } },
          // Снятое или возвращённое вручную — уже не «на время отпуска».
          data: { status: action === 'pause' ? 'paused' : 'active', pausedForAway: false },
        })
      : { count: 0 };
    for (const l of found) await this.search.indexListing(l.id);
    return { done: changed.count, skipped: ids.length - changed.count };
  }

  /** Отпуск продавца: с какого времени и сколько лотов ждут возвращения. */
  async getAway(sellerId: string) {
    const [profile, paused] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId: sellerId }, select: { awaySince: true } }),
      this.prisma.listing.count({ where: { sellerId, pausedForAway: true } }),
    ]);
    return { awaySince: profile?.awaySince ?? null, paused };
  }

  /**
   * «Отпуск»: продающиеся лоты снимаются разом и помечаются. По возвращении
   * в продажу идут только они — снятые раньше вручную остаются снятыми.
   * Открытые заказы отпуск не трогает: их нужно довести.
   */
  async setAway(sellerId: string, away: boolean) {
    const profile = await this.prisma.profile.findUnique({ where: { userId: sellerId }, select: { awaySince: true } });
    if (!profile) throw new NotFoundException('Профиль не найден');
    if (away) {
      const rows = await this.prisma.listing.findMany({ where: { sellerId, status: 'active' }, select: { id: true } });
      const awaySince = profile.awaySince ?? new Date();
      await this.prisma.$transaction([
        this.prisma.profile.update({ where: { userId: sellerId }, data: { awaySince } }),
        this.prisma.listing.updateMany({
          where: { id: { in: rows.map((r) => r.id) }, status: 'active' },
          data: { status: 'paused', pausedForAway: true },
        }),
      ]);
      for (const r of rows) await this.search.indexListing(r.id);
      return { awaySince, paused: rows.length };
    }
    const rows = await this.prisma.listing.findMany({ where: { sellerId, pausedForAway: true }, select: { id: true } });
    const [, restored] = await this.prisma.$transaction([
      this.prisma.profile.update({ where: { userId: sellerId }, data: { awaySince: null } }),
      this.prisma.listing.updateMany({
        where: { sellerId, pausedForAway: true, status: 'paused', OR: [{ stock: null }, { stock: { gt: 0 } }] },
        data: { status: 'active', pausedForAway: false },
      }),
      // Наличие обнулили, пока продавец отдыхал, — лот возвращается закончившимся.
      this.prisma.listing.updateMany({
        where: { sellerId, pausedForAway: true, status: 'paused', stock: 0 },
        data: { status: 'sold_out', pausedForAway: false },
      }),
      this.prisma.listing.updateMany({ where: { sellerId, pausedForAway: true }, data: { pausedForAway: false } }),
    ]);
    for (const r of rows) await this.search.indexListing(r.id);
    return { awaySince: null, restored: restored.count };
  }

  async create(sellerId: string, input: CreateListingInput) {
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, gameId: input.gameId },
    });
    if (!category) throw new NotFoundException('Категория не найдена для указанной игры');

    await this.validateAttributes(input.categoryId, input.attributes);
    const fulfillment = this.fulfillmentOf(category, input.autoDelivery);
    const terms = input.topup ? this.topupTerms(fulfillment, input.topup) : null;
    const buyerFields = this.buyerFields(fulfillment, input.buyerFields);
    const qty =
      fulfillment === 'auto_key' && category.fulfillmentType === 'manual'
        ? PER_LINE
        : this.qtyTerms(
            fulfillment,
            {
              unitName: input.unitName ?? null,
              pricePerUnits: input.pricePerUnits ?? 1,
              minQty: input.minQty ?? 1,
              stock: input.stock,
            },
            sectionPack(category),
          );

    const created = await this.prisma.listing.create({
      data: {
        sellerId,
        gameId: input.gameId,
        categoryId: input.categoryId,
        title: input.title,
        description: input.description,
        price: terms ? topupQuote(terms.min, terms.markupBps).price : BigInt(input.price),
        topupMarkupBps: terms?.markupBps ?? null,
        topupMin: terms?.min ?? null,
        topupMax: terms?.max ?? null,
        ...qty,
        buyerFields,
        currency: input.currency,
        attributes: input.attributes as Prisma.InputJsonValue,
        images: input.images as Prisma.InputJsonValue,
        // Наличие авто-лота — это склад ключей или строк: его ведёт
        // InventoryService. Пустой лот в каталог не выходит: купить его всё
        // равно нельзя. Первая загрузка склада переводит его в продажу (addKeys).
        stock: fulfillment === 'auto_key' ? 0 : qty.stock,
        status: fulfillment === 'auto_key' || qty.stock === 0 ? 'sold_out' : 'active',
        fulfillmentType: fulfillment,
        autoDelivery: fulfillment !== 'manual',
        deliveryTemplate: this.template(input.deliveryTemplate),
      },
      select: cardSelect,
    });
    await this.search.indexListing(created.id);
    return created;
  }

  /**
   * Способ выдачи лота. Ключи раздел выдаёт со склада всегда, пополнения —
   * через провайдера. У аккаунтов, предметов и услуг выбирает продавец:
   * передать в чате или выдавать сразу со склада строк — логин и пароль,
   * промокод, ссылка, как боты автовыдачи у продавцов FunPay. Не выбрал —
   * остаётся как было. Валюте с общей пачкой склад строк не подходит: её
   * продают количеством.
   */
  private fulfillmentOf(
    category: { fulfillmentType: FulfillmentType; unitName: string | null; pricePerUnits: number | null },
    autoDelivery: boolean | undefined,
    current: FulfillmentType = 'manual',
  ): FulfillmentType {
    if (category.fulfillmentType !== 'manual') return category.fulfillmentType;
    if (autoDelivery === undefined) return current;
    if (autoDelivery && sectionPack(category)) {
      throw new BadRequestException('Валюту продают количеством — автовыдача со склада здесь не подходит');
    }
    return autoDelivery ? 'auto_key' : 'manual';
  }

  /**
   * Сообщение покупателю после оплаты. Контакты скрываются сразу, как в
   * описании профиля: продавец видит в форме то же, что получит покупатель.
   */
  private template(raw: string | null | undefined): string | null {
    const text = raw?.trim();
    return text ? maskContacts(text).masked : null;
  }

  /**
   * Условия лота «на сумму покупателя». Только у пополнений через провайдера:
   * у аккаунта или ключа «сумма на выбор» не имеет смысла.
   */
  private topupTerms(fulfillmentType: FulfillmentType, raw: TopupTermsInput): TopupTerms {
    if (fulfillmentType !== 'provider') {
      throw new BadRequestException('Сумму на выбор покупателя можно задать только у пополнений');
    }
    const terms = { markupBps: raw.markupBps, min: BigInt(raw.min), max: BigInt(raw.max) };
    const error = topupTermsError(terms);
    if (error) throw new BadRequestException(error);
    return terms;
  }

  /**
   * Поля «что спросить у покупателя». Только у ручной выдачи: ключ и
   * пополнение выдаются автоматически, отвечать на вопросы там некому.
   */
  private buyerFields(fulfillmentType: FulfillmentType, raw: CreateListingInput['buyerFields']) {
    if (!raw?.length) return Prisma.DbNull;
    if (fulfillmentType !== 'manual') {
      throw new BadRequestException('Данные от покупателя спрашивают только у лотов с ручной выдачей');
    }
    return raw.map((f) => ({ label: f.label, required: f.required })) as Prisma.InputJsonValue;
  }

  /**
   * Условия продажи поштучно. Без единицы лот продаётся целиком: пачка и
   * минимум сбрасываются, наличие — как задал продавец. У пополнений
   * «количества» нет — у них сумма на выбор покупателя.
   */
  private qtyTerms(
    fulfillmentType: FulfillmentType,
    raw: { unitName: string | null; pricePerUnits: number; minQty: number; stock: number | null },
    pack: { unitName: string; pricePerUnits: number } | null = null,
  ) {
    // Раздел валюты с общей пачкой: все продают «за 1 000 золота», иначе
    // сортировка по цене сравнивала бы цену за 1 000 и за 1 000 000.
    if (pack && fulfillmentType === 'manual') {
      if (!raw.unitName?.trim()) {
        throw new BadRequestException(
          `В этом разделе продают количеством: укажите цену за ${formatUnits(pack.pricePerUnits, pack.unitName)}`,
        );
      }
      raw = { ...raw, unitName: pack.unitName, pricePerUnits: pack.pricePerUnits };
    }
    const unitName = raw.unitName?.trim() || null;
    if (!unitName) return { unitName: null, pricePerUnits: 1, minQty: 1, stock: raw.stock };
    if (fulfillmentType === 'provider') {
      throw new BadRequestException('У пополнений количество не задаётся — выберите сумму на выбор покупателя');
    }
    const terms = {
      unitName,
      pricePerUnits: raw.pricePerUnits,
      minQty: raw.minQty,
      // Наличие ключей считает склад, проверять ввод продавца незачем.
      stock: fulfillmentType === 'auto_key' ? 0 : raw.stock,
    };
    const error = qtyTermsError(terms);
    if (error) throw new BadRequestException(error);
    return { ...terms, stock: raw.stock };
  }

  /** Проверка атрибутов лота против схемы категории (обязательные + enum-опции). */
  private async validateAttributes(categoryId: string, attrs: Record<string, unknown>) {
    const schema = await this.prisma.attribute.findMany({ where: { categoryId } });
    for (const a of schema) {
      const val = attrs?.[a.key];
      const empty = val === undefined || val === null || val === '';
      if (a.isRequired && empty) {
        throw new BadRequestException(`Укажите характеристику «${a.label}»`);
      }
      if (!empty && a.type === 'enum' && Array.isArray(a.options)) {
        if (!(a.options as unknown[]).map(String).includes(String(val))) {
          throw new BadRequestException(`Недопустимое значение «${a.label}»`);
        }
      }
    }
  }

  async update(sellerId: string, id: string, input: UpdateListingInput) {
    const current = await this.assertOwner(sellerId, id);
    // Заблокированный модератором лот продавец сам в продажу не возвращает:
    // раньше хватало PATCH со status=active, и блокировка ничего не значила.
    if (current.status === 'blocked') {
      throw new ForbiddenException('Лот заблокирован модератором. Напишите в поддержку.');
    }
    if (current.status === 'archived') throw new NotFoundException('Лот не найден');
    // Во время скидки price — сниженная, прежняя хранится отдельно: новая
    // цена или пачка смешали бы их. Форма шлёт цену и без правки — та же
    // цена не в счёт.
    if (
      current.saleUntil &&
      ((input.price !== undefined && BigInt(input.price) !== current.price) ||
        (input.pricePerUnits !== undefined && input.pricePerUnits !== current.pricePerUnits))
    ) {
      throw new BadRequestException('Идёт скидка — завершите её, потом меняйте цену');
    }
    // Характеристики проверялись только при создании: правкой можно было
    // убрать обязательное «Звание» или вписать значение не из списка.
    if (input.attributes !== undefined) await this.validateAttributes(current.categoryId, input.attributes);
    const data: Prisma.ListingUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.deliveryTemplate !== undefined) data.deliveryTemplate = this.template(input.deliveryTemplate);
    // Способ выдачи после правки: у аккаунтов, предметов и услуг продавец
    // включает и выключает автовыдачу, у ключей и пополнений его задаёт раздел.
    const fulfillment = this.fulfillmentOf(current.category, input.autoDelivery, current.fulfillmentType);
    const auto = fulfillment === 'auto_key';
    const switched = fulfillment !== current.fulfillmentType;
    if (switched) {
      data.fulfillmentType = fulfillment;
      data.autoDelivery = auto;
    }
    // У лота «на сумму покупателя» цена не задаётся, а следует из условий.
    if (input.topup) {
      const terms = this.topupTerms(fulfillment, input.topup);
      data.topupMarkupBps = terms.markupBps;
      data.topupMin = terms.min;
      data.topupMax = terms.max;
      data.price = topupQuote(terms.min, terms.markupBps).price;
    } else if (input.topup === null) {
      data.topupMarkupBps = null;
      data.topupMin = null;
      data.topupMax = null;
    }
    const variable = input.topup !== undefined ? input.topup !== null : current.topupMarkupBps != null;
    if (input.price !== undefined && !variable) data.price = BigInt(input.price);

    if (auto && current.category.fulfillmentType === 'manual') {
      // Автовыдачу включили: продаётся по строке, наличие — строки, которые
      // уже лежат на складе (в том числе с прошлого включения). Ник и сервер
      // со склада спрашивать некому.
      if (switched) {
        Object.assign(data, PER_LINE, {
          stock: await this.prisma.digitalGood.count({ where: { listingId: id, status: 'available' } }),
          buyerFields: Prisma.DbNull,
        });
      }
    } else if (
      switched ||
      input.unitName !== undefined ||
      input.pricePerUnits !== undefined ||
      input.minQty !== undefined ||
      (input.stock !== undefined && !auto)
    ) {
      // Поштучно: проверяем итоговые условия — старые значения плюс
      // изменённые. Автовыдачу выключили — наличие склада к ручной выдаче не
      // относится: без нового наличия лот продаётся без ограничения.
      const q = this.qtyTerms(
        fulfillment,
        {
          unitName: input.unitName !== undefined ? input.unitName : current.unitName,
          pricePerUnits: input.pricePerUnits ?? current.pricePerUnits,
          minQty: input.minQty ?? current.minQty,
          stock: auto
            ? current.stock
            : input.stock !== undefined
              ? input.stock
              : switched
                ? null
                : current.stock,
        },
        sectionPack(current.category),
      );
      data.unitName = q.unitName;
      data.pricePerUnits = q.pricePerUnits;
      data.minQty = q.minQty;
      if (!auto) data.stock = q.stock;
    }
    // Распроданный лот с пополненным наличием возвращается в продажу сам —
    // как «восстановление лота» у продавцов FunPay.
    if (current.status === 'sold_out' && input.status === undefined && (!auto || switched)) {
      const stock = data.stock !== undefined ? (data.stock as number | null) : current.stock;
      if (stock == null || stock > 0) data.status = 'active';
    }
    // Наличие обнулили правкой — лот уходит из каталога, как после продажи последней штуки.
    if (data.stock === 0 && current.status === 'active' && input.status === undefined) data.status = 'sold_out';
    if (input.buyerFields !== undefined) data.buyerFields = this.buyerFields(fulfillment, input.buyerFields);
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.attributes !== undefined) data.attributes = input.attributes as Prisma.InputJsonValue;
    if (input.images !== undefined) data.images = input.images as Prisma.InputJsonValue;
    // Наличие обычного лота — выше, вместе с условиями поштучной продажи;
    // наличие авто-лота меняет только склад. Снятый или возвращённый
    // вручную лот — уже не «на время отпуска».
    if (input.status !== undefined) {
      data.status = input.status;
      data.pausedForAway = false;
    }
    // Вернуть в продажу лот без наличия нельзя: заказ на него сразу упадёт.
    if (input.status === 'active') {
      const stock = data.stock !== undefined ? (data.stock as number | null) : current.stock;
      if (stock === 0) {
        throw new BadRequestException(
          auto ? 'Склад пуст — загрузите товар, и лот вернётся в продажу' : 'Лот закончился — укажите наличие',
        );
      }
    }

    const updated = await this.prisma.listing.update({ where: { id }, data, select: cardSelect });
    await this.search.indexListing(id);
    return updated;
  }

  /**
   * Удаление лота. Заказы ссылаются на лот внешним ключом, и удаление лота
   * с продажами падало с ошибкой базы. Такой лот уходит в архив: из каталога
   * и кабинета пропадает, а история сделок и споров остаётся целой.
   */
  async remove(sellerId: string, id: string) {
    const current = await this.assertOwner(sellerId, id);
    if (current.status === 'blocked') {
      throw new ForbiddenException('Лот заблокирован модератором. Напишите в поддержку.');
    }
    if (current.status === 'archived') throw new NotFoundException('Лот не найден');
    const orders = await this.prisma.order.count({ where: { listingId: id } });
    if (orders > 0) {
      await this.prisma.listing.update({ where: { id }, data: { status: 'archived' } });
    } else {
      await this.prisma.favorite.deleteMany({ where: { listingId: id } });
      await this.prisma.listing.delete({ where: { id } });
    }
    await this.search.removeListing(id);
    return { ok: true, archived: orders > 0 };
  }

  private async assertOwner(sellerId: string, id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: {
        sellerId: true,
        status: true,
        price: true,
        saleUntil: true,
        categoryId: true,
        fulfillmentType: true,
        topupMarkupBps: true,
        unitName: true,
        pricePerUnits: true,
        minQty: true,
        stock: true,
        category: { select: { fulfillmentType: true, unitName: true, pricePerUnits: true } },
      },
    });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш лот');
    return listing;
  }
}
