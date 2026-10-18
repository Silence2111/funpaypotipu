import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import {
  NOTIFY_LABELS,
  notifyGroupOf,
  notifyLink,
  wantsNotify,
  type NotifyGroup,
  type NotifyPrefs,
} from '@gamemarket/shared';
import { MailService } from '../mail/mail.service';
import { TelegramService } from './telegram.service';
import { PushService, type PushMessage } from './push.service';

/** Темы писем для важных событий; для остальных — подпись из shared/notify.ts. */
const EMAIL_SUBJECTS: Record<string, string> = {
  order_paid: 'Новый оплаченный заказ',
  order_delivered: 'Товар по заказу выдан',
  order_refunded: 'Возврат по заказу',
  payment_to_balance: 'Оплата зачислена на баланс',
  listing_blocked: 'Лот заблокирован модератором',
  account_status: 'Статус вашего аккаунта изменён',
  payout_paid: 'Выплата отправлена',
  payout_rejected: 'Заявка на вывод отклонена',
  dispute_opened: 'Открыт спор по вашей сделке',
  dispute_resolved: 'Спор по сделке разрешён',
  review_received: 'Вы получили новый отзыв',
};

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';

/** Пуши этих групп будят телефон сразу: ждут покупатель, продавец или арбитр. */
const URGENT: Array<NotifyGroup | null> = ['orders', 'messages', 'disputes'];

/** Страницы, у которых одно уведомление на экране: новое заменяет прежнее. */
const TAGGED = /^\/(chat|orders|disputes|cabinet\/support)\//;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
    private readonly push: PushService,
  ) {}

  /**
   * Уведомление на сайте и, по настройкам пользователя, письмом, в Telegram
   * и пушем. Каналы и группы — shared/notify.ts: те же, что в настройках.
   */
  async notify(userId: string, type: string, payload: Prisma.InputJsonValue = {}) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, channel: 'in_app', payload },
    });

    // Тема письма — своя для важных событий, иначе та же подпись, что на сайте:
    // галочка «письмом» в настройках должна работать для любой группы.
    const subject = EMAIL_SUBJECTS[type] ?? NOTIFY_LABELS[type];
    const viaMail = !!subject && this.mail.enabled;
    if (!viaMail && !this.telegram.enabled && !this.push.enabled) return notification;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, telegramId: true, notifyPrefs: true },
    });
    if (!user) return notification;
    const prefs = user.notifyPrefs as NotifyPrefs | null;
    const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const link = `${WEB_URL}${notifyLink(type, data)}`;

    if (viaMail && user.email && wantsNotify(prefs, 'email', type)) {
      await this.mail.send(user.email, subject, `${subject}.\n\nПодробности: ${link}`);
    }
    if (user.telegramId && this.telegram.enabled && wantsNotify(prefs, 'telegram', type)) {
      // Не ждём: медленный Telegram не должен задерживать оплату или чат.
      void this.telegram.send(user.telegramId, this.telegramText(type, data, link));
    }
    if (this.push.enabled && wantsNotify(prefs, 'push', type)) void this.pushTo(userId, type, data);
    return notification;
  }

  /** Пуш на устройства пользователя. Не ждём, как и Telegram. */
  private async pushTo(userId: string, type: string, data: Record<string, unknown>) {
    try {
      if (!(await this.push.devices(userId))) return;
      await this.push.send(
        userId,
        await this.pushMessage(type, data),
        URGENT.includes(notifyGroupOf(type)),
      );
    } catch (e) {
      this.logger.warn(`Пуш не отправлен: ${(e as Error).message}`);
    }
  }

  /**
   * Заголовок — та же подпись, что на сайте, у сообщения — от кого. Текст —
   * превью сообщения или название лота: продавцу с десятком заказов
   * «Заказ оплачен» без названия ничего не скажет.
   */
  private async pushMessage(type: string, data: Record<string, unknown>): Promise<PushMessage> {
    const str = (k: string) =>
      typeof data[k] === 'string' && data[k] ? (data[k] as string) : null;
    let body = str('preview') ?? str('title');
    const orderId = str('orderId');
    if (!body && orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { publicNumber: true, listingSnapshot: true },
      });
      body =
        (order?.listingSnapshot as { title?: string } | null)?.title ?? order?.publicNumber ?? null;
    }
    const from = type === 'new_message' ? str('from') : null;
    const url = notifyLink(type, data);
    return {
      title: from ? `Сообщение от ${from}` : (NOTIFY_LABELS[type] ?? 'GameMarket'),
      body: body ?? '',
      url,
      ...(TAGGED.test(url) ? { tag: url } : {}),
    };
  }

  private telegramText(type: string, data: Record<string, unknown>, link: string): string {
    const title = NOTIFY_LABELS[type] ?? 'Уведомление GameMarket';
    const preview = typeof data.preview === 'string' && data.preview ? `\n«${data.preview}»` : '';
    return `${title}${preview}\n${link}`;
  }

  /**
   * Колокольчик: всё, кроме новых сообщений. У сообщений свой счётчик в
   * шапке и свой список — в мессенджере; в колокольчике они тонули бы
   * события сделок.
   */
  listMine(userId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: { userId, type: { not: 'new_message' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async markRead(id: string, userId: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, type: { not: 'new_message' } },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
