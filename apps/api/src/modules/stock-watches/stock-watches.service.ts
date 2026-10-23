import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { langOf, say } from '../../i18n/texts';

/** Как часто искать лоты, которые снова в продаже. В CI — чаще. */
const SWEEP_MS = Number(process.env.STOCK_WATCH_INTERVAL_MS ?? 2 * 60_000);
/** Сколько ожиданий разбирать за проход. */
const BATCH = 500;
/** Сколько закончившихся лотов человек ждёт одновременно. */
export const MAX_STOCK_WATCHES = 100;

interface BackRow {
  id: string;
  user_id: string;
  listing_id: string;
  title: string;
  locale: string | null;
}

/**
 * «Сообщить о поступлении»: лот закончился — человек нажимает кнопку на его
 * странице, и когда продавец пополнит наличие, приходит одно уведомление.
 * Ожидание после него удаляется: второй раз о том же лоте не напомним.
 */
@Injectable()
export class StockWatchesService {
  private readonly logger = new Logger(StockWatchesService.name);
  private running = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  async status(userId: string, listingId: string) {
    const found = await this.prisma.stockWatch.findUnique({
      where: { userId_listingId: { userId, listingId } },
      select: { id: true },
    });
    return { watching: !!found };
  }

  async watch(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { status: true, sellerId: true },
    });
    if (!listing || (listing.status !== 'sold_out' && listing.status !== 'active')) {
      throw new NotFoundException('Лот не найден');
    }
    if (listing.sellerId === userId) throw new BadRequestException('Это ваш лот');
    if (listing.status === 'active')
      throw new BadRequestException('Лот в продаже — его можно купить сейчас');
    const already = await this.status(userId, listingId);
    if (already.watching) return already;
    const count = await this.prisma.stockWatch.count({ where: { userId } });
    if (count >= MAX_STOCK_WATCHES) {
      throw new BadRequestException(`Ждать можно не больше ${MAX_STOCK_WATCHES} лотов сразу`);
    }
    await this.prisma.stockWatch.createMany({
      data: [{ userId, listingId }],
      skipDuplicates: true,
    });
    return { watching: true };
  }

  async unwatch(userId: string, listingId: string) {
    await this.prisma.stockWatch.deleteMany({ where: { userId, listingId } });
    return { watching: false };
  }

  /**
   * Лоты, которые снова в продаже: каждому, кто ждал, — уведомление, и
   * ожидание удаляется. Чёрный список и свой лот молчат; удалённый лот
   * ждать больше нечего — ожидание убирается без уведомления.
   */
  @Interval('stock-watches', SWEEP_MS)
  async sweep(): Promise<{ notified: number }> {
    if (this.running) return { notified: 0 };
    this.running = true;
    try {
      const rows = await this.prisma.$queryRaw<BackRow[]>`
        SELECT w.id, w.user_id, w.listing_id, l.title, u.locale
        FROM stock_watches w
        JOIN listings l ON l.id = w.listing_id
        JOIN users u ON u.id = w.user_id
        WHERE l.status = 'active' AND u.status = 'active' AND l.seller_id <> w.user_id
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
            WHERE (b.blocker_id = l.seller_id AND b.blocked_id = w.user_id)
               OR (b.blocker_id = w.user_id AND b.blocked_id = l.seller_id)
          )
        ORDER BY w.created_at
        LIMIT ${BATCH}`;
      let notified = 0;
      for (const r of rows) {
        try {
          // Удаляем до уведомления: второй экземпляр API, нашедший то же
          // ожидание, ничего не удалит и промолчит.
          const gone = await this.prisma.stockWatch.deleteMany({ where: { id: r.id } });
          if (!gone.count) continue;
          await this.notifications.notify(r.user_id, 'back_in_stock', {
            listingId: r.listing_id,
            preview: say(langOf(r.locale), '«{title}» снова в продаже', { title: r.title }),
          });
          notified++;
        } catch (e) {
          this.logger.warn(`Ожидание ${r.id}: ${(e as Error).message}`);
        }
      }
      await this.prisma.$executeRaw`
        DELETE FROM stock_watches w USING listings l
        WHERE l.id = w.listing_id AND l.status = 'archived'`;
      return { notified };
    } finally {
      this.running = false;
    }
  }
}
