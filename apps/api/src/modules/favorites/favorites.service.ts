import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRICE_DROP_MIN_PCT } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { langOf, say } from '../../i18n/texts';

/** Как часто сверять цены лотов в избранном. В CI — чаще. */
const SWEEP_MS = Number(process.env.PRICE_DROP_INTERVAL_MS ?? 5 * 60_000);
/** Сколько подешевевших лотов разбирать за проход. */
const BATCH = 500;

/**
 * Цена за единицу: у поштучного лота цена — за пачку, и продавец может
 * сменить пачку (за 100 вместо 1 000) без всякой скидки.
 */
const unitPrice = (price: bigint, pack: number) => new Prisma.Decimal(price.toString()).div(pack);

/** Цена за единицу → цена текущей пачки лота, в копейках. */
const packPrice = (unit: Prisma.Decimal | string, pack: number) =>
  BigInt(new Prisma.Decimal(unit).mul(pack).toDecimalPlaces(0).toFixed(0));

interface DropRow {
  id: string;
  user_id: string;
  listing_id: string;
  watch: string;
  price: bigint;
  pack: number;
  title: string;
  locale: string | null;
}

@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);
  private running = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * В избранное — с ценой за единицу на этот момент: от неё считается
   * снижение и «было». Лот «на сумму покупателя» цены не отслеживает: его
   * «от» зависит от минимальной суммы, а не от скидки.
   */
  async add(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { price: true, pricePerUnits: true, topupMarkupBps: true },
    });
    const unit =
      listing && listing.topupMarkupBps == null
        ? unitPrice(listing.price, listing.pricePerUnits)
        : null;
    await this.prisma.favorite.upsert({
      where: { userId_listingId: { userId, listingId } },
      update: {},
      create: { userId, listingId, addedUnitPrice: unit, watchUnitPrice: unit },
    });
    return { ok: true };
  }

  async remove(userId: string, listingId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, listingId } });
    return { ok: true };
  }

  /**
   * Избранное новыми сверху: цена «было», когда добавили, игра, скидка и
   * «минимум за 30 дней» — для фильтров и сортировки в кабинете.
   */
  async listMine(userId: string) {
    const favs = await this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { listingId: true, addedUnitPrice: true, createdAt: true },
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
        topupMarkupBps: true, // лот «на сумму покупателя»: в избранном цена «от»
        unitName: true, // поштучно: цена «за 1 000 золота»
        pricePerUnits: true,
        saleListPrice: true,
        saleRefPrice: true,
        saleUntil: true,
        priceLowUntil: true,
        priceLowRef: true,
        priceDropPct: true,
        game: { select: { slug: true, title: true } },
        seller: { select: { profile: { select: { username: true, ratingAvg: true } } } },
      },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));
    const added = new Map(favs.map((f) => [f.listingId, f.addedUnitPrice]));
    const addedAt = new Map(favs.map((f) => [f.listingId, f.createdAt]));
    return ids
      .map((id) => byId.get(id))
      .filter((l): l is (typeof listings)[number] => !!l)
      .map((l) => {
        // «Было» — цена при добавлении в той же пачке, если сейчас дешевле.
        const unit = added.get(l.id);
        const was = unit && l.topupMarkupBps == null ? packPrice(unit, l.pricePerUnits) : null;
        return {
          ...l,
          wasPrice: was != null && was > l.price ? was.toString() : null,
          addedAt: addedAt.get(l.id),
        };
      });
  }

  /**
   * Подешевевшие лоты из избранного: цена за единицу упала хотя бы на
   * PRICE_DROP_MIN_PCT от последней известной — уведомление, и новая цена
   * становится точкой отсчёта. Подорожал и вернулся к прежней — не повод:
   * эту цену человек уже видел. Свои лоты и чёрный список не в счёт.
   */
  @Interval('price-drops', SWEEP_MS)
  async priceSweep(): Promise<{ notified: number }> {
    if (this.running) return { notified: 0 };
    this.running = true;
    try {
      const keep = 100 - PRICE_DROP_MIN_PCT;
      const rows = await this.prisma.$queryRaw<DropRow[]>`
        SELECT f.id, f.user_id, f.listing_id, f.watch_unit_price::text AS watch,
               l.price, l.price_per_units AS pack, l.title, u.locale
        FROM favorites f
        JOIN listings l ON l.id = f.listing_id
        JOIN users u ON u.id = f.user_id
        WHERE f.watch_unit_price IS NOT NULL
          AND l.status = 'active' AND l.topup_markup_bps IS NULL
          AND l.seller_id <> f.user_id AND u.status = 'active'
          AND l.price::numeric * 100 <= f.watch_unit_price * l.price_per_units * ${keep}
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
            WHERE (b.blocker_id = l.seller_id AND b.blocked_id = f.user_id)
               OR (b.blocker_id = f.user_id AND b.blocked_id = l.seller_id)
          )
        LIMIT ${BATCH}`;
      let notified = 0;
      for (const r of rows) {
        try {
          if (await this.notifyDrop(r)) notified++;
        } catch (e) {
          this.logger.warn(`Избранное ${r.id}: ${(e as Error).message}`);
        }
      }
      return { notified };
    } finally {
      this.running = false;
    }
  }

  private async notifyDrop(r: DropRow): Promise<boolean> {
    const price = BigInt(r.price);
    // Точка отсчёта сдвигается до уведомления и только с прежней: второй
    // экземпляр API, нашедший то же снижение, ничего не обновит и промолчит.
    const moved = await this.prisma.favorite.updateMany({
      where: { id: r.id, watchUnitPrice: new Prisma.Decimal(r.watch) },
      data: { watchUnitPrice: unitPrice(price, r.pack) },
    });
    if (!moved.count) return false;
    const lang = langOf(r.locale);
    const rub = (minor: bigint) =>
      `${(Number(minor) / 100).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')} ₽`;
    const before = packPrice(r.watch, r.pack);
    await this.notifications.notify(r.user_id, 'price_drop', {
      listingId: r.listing_id,
      oldPrice: before.toString(),
      newPrice: price.toString(),
      preview: say(lang, '«{title}»: было {old}, стало {new}', {
        title: r.title,
        old: rub(before),
        new: rub(price),
      }),
    });
    return true;
  }
}
