import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { ListingsService } from '../listings/listings.service';
import { assetUrl } from '../storage/asset-url';
import { ONLINE_MS } from '../../common/presence';
import { langOf, say } from '../../i18n/texts';
import type { Lang } from '../../i18n/lang';

/** Как часто искать новые лоты и скидки у продавцов с подписчиками. В CI — чаще. */
const SWEEP_MS = Number(process.env.FOLLOW_INTERVAL_MS ?? 5 * 60_000);
/**
 * Проход смотрит на секунду назад: лот, чья транзакция ещё не закончилась,
 * попадёт в следующий проход, а не проскочит мимо отметки.
 */
const LAG_MS = 1000;
/** Сколько новых лотов и скидок одного продавца разбирать за проход. */
const BATCH = 50;
export const MAX_FOLLOWS = 200;
/** Лотов на страницу ленты подписок. */
export const FEED_LIMIT = 20;

interface Lot {
  id: string;
  title: string;
  price: bigint;
  saleListPrice: bigint | null;
  createdAt: Date;
  saleStartedAt: Date | null;
}

interface Follow {
  id: string;
  userId: string;
  since: Date;
  user: { locale: string | null };
}

/**
 * Подписка на продавца: его новые лоты и начатые скидки приходят
 * уведомлением — на сайте, в Telegram и пушем, группа «Поиски, избранное и
 * подписки». У каждой подписки — отметка «с этого момента новое»: проход
 * сдвигает её, поэтому одно и то же не приходит дважды. Чёрный список в
 * обе стороны молчит.
 */
@Injectable()
export class FollowsService {
  private readonly logger = new Logger(FollowsService.name);
  private running = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly listings: ListingsService,
  ) {}

  /** «Мои подписки»: кто, в сети ли, сколько лотов и сколько со скидкой. */
  async list(userId: string) {
    const rows = await this.prisma.sellerFollow.findMany({
      where: { userId, seller: { status: { not: 'banned' } } },
      orderBy: { createdAt: 'desc' },
      select: {
        sellerId: true,
        notify: true,
        createdAt: true,
        seller: {
          select: {
            profile: {
              select: { username: true, avatarUrl: true, onlineAt: true, awaySince: true },
            },
          },
        },
      },
    });
    const ids = rows.map((r) => r.sellerId);
    const [lots, sales] = await Promise.all([
      this.prisma.listing.groupBy({
        by: ['sellerId'],
        where: { sellerId: { in: ids }, status: 'active' },
        _count: { _all: true },
      }),
      this.prisma.listing.groupBy({
        by: ['sellerId'],
        where: { sellerId: { in: ids }, status: 'active', saleUntil: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const count = (g: typeof lots, id: string) =>
      g.find((x) => x.sellerId === id)?._count._all ?? 0;
    const now = Date.now();
    return rows.flatMap((r) => {
      const p = r.seller.profile;
      if (!p) return [];
      return [
        {
          sellerId: r.sellerId,
          username: p.username,
          avatarUrl: assetUrl(p.avatarUrl),
          online: !!p.onlineAt && now - p.onlineAt.getTime() < ONLINE_MS,
          onlineAt: p.onlineAt,
          away: p.awaySince !== null,
          activeListings: count(lots, r.sellerId),
          onSale: count(sales, r.sellerId),
          notify: r.notify,
          createdAt: r.createdAt,
        },
      ];
    });
  }

  /**
   * Лента подписок. Первая страница новых — это «посмотрел ленту»: отметка
   * визита сдвигается на сейчас, а прежняя считает «с прошлого визита».
   * Первый визит — без счётчика: новым тогда было бы всё.
   */
  async feed(userId: string, tab: 'new' | 'sale', page: number) {
    let freshSince: Date | null = null;
    if (tab === 'new' && page === 1) {
      const profile = await this.prisma.profile.findUnique({
        where: { userId },
        select: { followFeedSeenAt: true },
      });
      freshSince = profile?.followFeedSeenAt ?? null;
      await this.prisma.profile.updateMany({
        where: { userId },
        data: { followFeedSeenAt: new Date() },
      });
    }
    return this.listings.followFeed(userId, {
      sale: tab === 'sale',
      page,
      limit: FEED_LIMIT,
      freshSince,
    });
  }

  followers(sellerId: string) {
    return this.prisma.sellerFollow.count({ where: { sellerId } });
  }

  /** Для кнопки в профиле: подписан ли и сколько подписчиков. */
  async status(userId: string, sellerId: string) {
    const [row, followers] = await Promise.all([
      this.prisma.sellerFollow.findUnique({
        where: { userId_sellerId: { userId, sellerId } },
        select: { notify: true },
      }),
      this.followers(sellerId),
    ]);
    return { following: !!row, notify: row?.notify ?? false, followers };
  }

  /** Подписаться; повтор — без ошибки: кнопку могли нажать в двух вкладках. */
  async follow(userId: string, sellerId: string) {
    if (userId === sellerId) throw new BadRequestException('На себя подписаться нельзя');
    const seller = await this.prisma.profile.findUnique({
      where: { userId: sellerId },
      select: { user: { select: { status: true } } },
    });
    if (!seller || seller.user.status === 'banned') {
      throw new NotFoundException('Продавец не найден');
    }
    const existing = await this.prisma.sellerFollow.findUnique({
      where: { userId_sellerId: { userId, sellerId } },
      select: { notify: true },
    });
    if (!existing) {
      const count = await this.prisma.sellerFollow.count({ where: { userId } });
      if (count >= MAX_FOLLOWS) {
        throw new BadRequestException(`Не больше ${MAX_FOLLOWS} подписок — отпишитесь от ненужных`);
      }
      await this.prisma.sellerFollow.createMany({
        data: [{ userId, sellerId }],
        skipDuplicates: true,
      });
    }
    return {
      following: true,
      notify: existing?.notify ?? true,
      followers: await this.followers(sellerId),
    };
  }

  async unfollow(userId: string, sellerId: string) {
    await this.prisma.sellerFollow.deleteMany({ where: { userId, sellerId } });
    return { following: false, notify: false, followers: await this.followers(sellerId) };
  }

  /**
   * Уведомления по подписке. Включённые снова считают новым то, что после
   * включения: пропущенное за время тишины не приходит пачкой.
   */
  async setNotify(userId: string, sellerId: string, notify: boolean) {
    const row = await this.prisma.sellerFollow.findUnique({
      where: { userId_sellerId: { userId, sellerId } },
      select: { id: true, notify: true },
    });
    if (!row) throw new NotFoundException('Подписка не найдена');
    if (row.notify !== notify) {
      await this.prisma.sellerFollow.update({
        where: { id: row.id },
        data: notify ? { notify, since: new Date() } : { notify },
      });
    }
    return { notify };
  }

  /** Проход по продавцам с подписчиками; сбой одного не мешает остальным. */
  @Interval('follows', SWEEP_MS)
  async sweep(): Promise<{ sellers: number; notified: number }> {
    if (this.running) return { sellers: 0, notified: 0 };
    this.running = true;
    try {
      const at = new Date(Date.now() - LAG_MS);
      const follows = await this.prisma.sellerFollow.findMany({
        where: {
          notify: true,
          since: { lt: at },
          user: { status: 'active' },
          seller: { status: 'active' },
        },
        select: {
          id: true,
          userId: true,
          sellerId: true,
          since: true,
          user: { select: { locale: true } },
        },
      });
      const bySeller = new Map<string, Follow[]>();
      for (const f of follows) {
        const list = bySeller.get(f.sellerId) ?? [];
        list.push(f);
        bySeller.set(f.sellerId, list);
      }
      let notified = 0;
      for (const [sellerId, list] of bySeller) {
        try {
          notified += await this.sweepSeller(sellerId, list, at);
        } catch (e) {
          this.logger.warn(`Подписчики ${sellerId}: ${(e as Error).message}`);
        }
      }
      return { sellers: bySeller.size, notified };
    } finally {
      this.running = false;
    }
  }

  /**
   * Новое у одного продавца — одним запросом на всех подписчиков, от самой
   * ранней отметки; каждому — то, что после его отметки.
   */
  private async sweepSeller(sellerId: string, follows: Follow[], at: Date): Promise<number> {
    const from = new Date(Math.min(...follows.map((f) => f.since.getTime())));
    const userIds = follows.map((f) => f.userId);
    const select = {
      id: true,
      title: true,
      price: true,
      saleListPrice: true,
      createdAt: true,
      saleStartedAt: true,
    } as const;
    const [fresh, sales, profile, blocks] = await Promise.all([
      this.prisma.listing.findMany({
        where: { sellerId, status: 'active', createdAt: { gt: from, lte: at } },
        orderBy: { createdAt: 'desc' },
        take: BATCH,
        select,
      }),
      this.prisma.listing.findMany({
        where: {
          sellerId,
          status: 'active',
          saleUntil: { gt: at },
          saleStartedAt: { gt: from, lte: at },
        },
        orderBy: { saleStartedAt: 'desc' },
        take: BATCH,
        select,
      }),
      this.prisma.profile.findUnique({ where: { userId: sellerId }, select: { username: true } }),
      // Чёрный список в обе стороны: заблокировавший не продаст, а
      // заблокированного покупатель слышать не хочет.
      this.prisma.userBlock.findMany({
        where: {
          OR: [
            { blockerId: sellerId, blockedId: { in: userIds } },
            { blockedId: sellerId, blockerId: { in: userIds } },
          ],
        },
        select: { blockerId: true, blockedId: true },
      }),
    ]);
    const blocked = new Set(
      blocks.map((b) => (b.blockerId === sellerId ? b.blockedId : b.blockerId)),
    );
    const seller = profile?.username ?? '';

    let notified = 0;
    const quiet: string[] = [];
    for (const f of follows) {
      const newLots = fresh.filter((l) => l.createdAt > f.since);
      const isNew = new Set(newLots.map((l) => l.id));
      // Новый лот сразу со скидкой — одно уведомление, о новом.
      const saleLots = sales.filter((l) => l.saleStartedAt! > f.since && !isNew.has(l.id));
      if (blocked.has(f.userId) || (!newLots.length && !saleLots.length)) {
        quiet.push(f.id);
        continue;
      }
      // Отметка сдвигается до уведомления и только с прежней: второй
      // экземпляр API, нашедший то же, ничего не обновит и промолчит.
      const moved = await this.prisma.sellerFollow.updateMany({
        where: { id: f.id, since: f.since },
        data: { since: at },
      });
      if (!moved.count) continue;
      const lang = langOf(f.user.locale);
      if (newLots.length) {
        await this.notifications.notify(
          f.userId,
          'seller_new_lots',
          this.payload(sellerId, seller, newLots, lang, false),
        );
      }
      if (saleLots.length) {
        await this.notifications.notify(
          f.userId,
          'seller_sale',
          this.payload(sellerId, seller, saleLots, lang, true),
        );
      }
      notified++;
    }
    // Без нового отметка тоже сдвигается — окно следующего прохода не растёт.
    // «Меньше at» — не назад, если другой экземпляр уже ушёл дальше.
    if (quiet.length) {
      await this.prisma.sellerFollow.updateMany({
        where: { id: { in: quiet }, since: { lt: at } },
        data: { since: at },
      });
    }
    return notified;
  }

  private payload(sellerId: string, seller: string, lots: Lot[], lang: Lang, sale: boolean) {
    const rub = (minor: bigint) =>
      `${(Number(minor) / 100).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')} ₽`;
    const first = lots[0]!;
    const vars = {
      title: first.title,
      price: rub(first.price),
      old: first.saleListPrice != null ? rub(first.saleListPrice) : '',
      n: lots.length - 1,
    };
    const more = lots.length > 1;
    const text = sale
      ? more
        ? say(lang, '«{title}» — {price} вместо {old} и ещё {n}', vars)
        : say(lang, '«{title}» — {price} вместо {old}', vars)
      : more
        ? say(lang, '«{title}» — {price} и ещё {n}', vars)
        : say(lang, '«{title}» — {price}', vars);
    return {
      sellerId,
      seller,
      count: lots.length,
      preview: `${seller}: ${text}`,
      ...(lots.length === 1 ? { listingId: first.id } : {}),
    };
  }
}
