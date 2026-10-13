import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { NOTIFY_LABELS, notifyLink, wantsNotify, type NotifyPrefs } from '@gamemarket/shared';
import { MailService } from '../mail/mail.service';
import { TelegramService } from './telegram.service';

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

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Уведомление на сайте и, по настройкам пользователя, письмом и в
   * Telegram. Каналы и группы — shared/notify.ts: те же, что в настройках.
   */
  async notify(userId: string, type: string, payload: Prisma.InputJsonValue = {}) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, channel: 'in_app', payload },
    });

    // Тема письма — своя для важных событий, иначе та же подпись, что на сайте:
    // галочка «письмом» в настройках должна работать для любой группы.
    const subject = EMAIL_SUBJECTS[type] ?? NOTIFY_LABELS[type];
    const viaMail = !!subject && this.mail.enabled;
    if (!viaMail && !this.telegram.enabled) return notification;

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
    return notification;
  }

  private telegramText(type: string, data: Record<string, unknown>, link: string): string {
    const title = NOTIFY_LABELS[type] ?? 'Уведомление GameMarket';
    const preview = typeof data.preview === 'string' && data.preview ? `\n«${data.preview}»` : '';
    return `${title}${preview}\n${link}`;
  }

  listMine(userId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: { userId },
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
}
