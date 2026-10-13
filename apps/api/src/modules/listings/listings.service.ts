import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type FulfillmentType } from '@gamemarket/db';
import {
  qtyTermsError,
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

const ASSET_BASE = process.env.PUBLIC_ASSET_BASE ?? '';
const BOOST_MS = 24 * 3600 * 1000; // лот держится в топе сутки

/** Кулдаун поднятия по заслугам: чем больше продаж, тем чаще (как на FunPay). */
const bumpCooldownMs = (sales: number) => (sales >= 50 ? 1 : sales >= 10 ? 2 : 4) * 3600 * 1000;

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
  seller: { select: { profile: { select: { username: true, ratingAvg: true, onlineAt: true } } } },
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

  private parseAttrs(raw?: string): Record<string, string> | undefined {
    if (!raw) return undefined;
    try {
      const o: unknown = JSON.parse(raw);
      if (!o || typeof o !== 'object') return undefined;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === 'string' && v) out[k] = v;
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
    if (query.q && this.search.enabled && !query.sellerId && !attrs && !query.instant && !query.online) {
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
    if (query.online) where.seller = { profile: { onlineAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } };
    if (query.gameSlug) where.game = { slug: query.gameSlug };
    if (query.categorySlug) where.category = { slug: query.categorySlug };
    // Фасетные фильтры по атрибутам (JSON-путь в Postgres).
    if (attrs) {
      where.AND = Object.entries(attrs).map(([k, v]) => ({
        attributes: { path: [k], equals: v },
      }));
    }
    if (query.q) where.title = { contains: query.q, mode: 'insensitive' };
    if (query.minPrice != null || query.maxPrice != null) {
      where.price = {
        gte: query.minPrice != null ? BigInt(query.minPrice) : undefined,
        lte: query.maxPrice != null ? BigInt(query.maxPrice) : undefined,
      };
    }

    // По умолчанию поднятые лоты (boostUntil) держатся выше — как «поднятие» на FunPay.
    const orderBy: Prisma.ListingOrderByWithRelationInput[] =
      query.sort === 'price_asc'
        ? [{ price: 'asc' }]
        : query.sort === 'price_desc'
          ? [{ price: 'desc' }]
          : query.sort === 'popular'
            ? [{ salesCount: 'desc' }, { createdAt: 'desc' }]
            : [{ boostUntil: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];

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
      select: { ...cardSelect, categoryId: true },
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
        category: { select: { slug: true, title: true, fulfillmentType: true } },
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
  async bumpAll(sellerId: string, categoryId?: string) {
    const [listings, profile] = await Promise.all([
      this.prisma.listing.findMany({
        where: { sellerId, status: 'active', ...(categoryId ? { categoryId } : {}) },
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

  async create(sellerId: string, input: CreateListingInput) {
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, gameId: input.gameId },
    });
    if (!category) throw new NotFoundException('Категория не найдена для указанной игры');

    await this.validateAttributes(input.categoryId, input.attributes);
    const terms = input.topup ? this.topupTerms(category.fulfillmentType, input.topup) : null;
    const buyerFields = this.buyerFields(category.fulfillmentType, input.buyerFields);
    const qty = this.qtyTerms(category.fulfillmentType, {
      unitName: input.unitName ?? null,
      pricePerUnits: input.pricePerUnits ?? 1,
      minQty: input.minQty ?? 1,
      stock: input.stock,
    });

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
        // Наличие авто-лота — это склад ключей: его ведёт InventoryService.
        // Без ключей лот в каталог не выходит: купить его всё равно нельзя.
        // Первая загрузка ключей переводит его в продажу (addKeys).
        stock: category.fulfillmentType === 'auto_key' ? 0 : qty.stock,
        status: category.fulfillmentType === 'auto_key' || qty.stock === 0 ? 'sold_out' : 'active',
        fulfillmentType: category.fulfillmentType,
        autoDelivery: category.fulfillmentType !== 'manual',
      },
      select: cardSelect,
    });
    await this.search.indexListing(created.id);
    return created;
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
  ) {
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
    // Характеристики проверялись только при создании: правкой можно было
    // убрать обязательное «Звание» или вписать значение не из списка.
    if (input.attributes !== undefined) await this.validateAttributes(current.categoryId, input.attributes);
    const data: Prisma.ListingUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    // У лота «на сумму покупателя» цена не задаётся, а следует из условий.
    if (input.topup) {
      const terms = this.topupTerms(current.category.fulfillmentType, input.topup);
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

    // Поштучно: проверяем итоговые условия — старые значения плюс изменённые.
    const auto = current.category.fulfillmentType === 'auto_key';
    if (
      input.unitName !== undefined ||
      input.pricePerUnits !== undefined ||
      input.minQty !== undefined ||
      (input.stock !== undefined && !auto)
    ) {
      const q = this.qtyTerms(current.category.fulfillmentType, {
        unitName: input.unitName !== undefined ? input.unitName : current.unitName,
        pricePerUnits: input.pricePerUnits ?? current.pricePerUnits,
        minQty: input.minQty ?? current.minQty,
        stock: auto ? current.stock : input.stock !== undefined ? input.stock : current.stock,
      });
      data.unitName = q.unitName;
      data.pricePerUnits = q.pricePerUnits;
      data.minQty = q.minQty;
      if (!auto) data.stock = q.stock;
    }
    // Распроданный лот с пополненным наличием возвращается в продажу сам —
    // как «восстановление лота» у продавцов FunPay.
    if (current.status === 'sold_out' && input.status === undefined && !auto) {
      const stock = data.stock !== undefined ? (data.stock as number | null) : current.stock;
      if (stock == null || stock > 0) data.status = 'active';
    }
    // Наличие обнулили правкой — лот уходит из каталога, как после продажи последней штуки.
    if (data.stock === 0 && current.status === 'active' && input.status === undefined) data.status = 'sold_out';
    if (input.buyerFields !== undefined) data.buyerFields = this.buyerFields(current.category.fulfillmentType, input.buyerFields);
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.attributes !== undefined) data.attributes = input.attributes as Prisma.InputJsonValue;
    if (input.images !== undefined) data.images = input.images as Prisma.InputJsonValue;
    // Наличие обычного лота — выше, вместе с условиями поштучной продажи;
    // наличие авто-лота меняет только склад ключей.
    if (input.status !== undefined) data.status = input.status;
    // Вернуть в продажу лот без наличия нельзя: заказ на него сразу упадёт.
    if (input.status === 'active') {
      const stock = data.stock !== undefined ? (data.stock as number | null) : current.stock;
      if (stock === 0) {
        throw new BadRequestException(
          auto ? 'На складе нет ключей — загрузите их, и лот вернётся в продажу' : 'Лот закончился — укажите наличие',
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
        categoryId: true,
        topupMarkupBps: true,
        unitName: true,
        pricePerUnits: true,
        minQty: true,
        stock: true,
        category: { select: { fulfillmentType: true } },
      },
    });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш лот');
    return listing;
  }
}
