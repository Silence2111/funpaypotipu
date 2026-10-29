import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import {
  EN_SHARED,
  HIDDEN_MARK,
  isPayoutRejectReason,
  NOTIFY_GROUPS,
  notifyGroupOf,
  notifyLink,
  wantsNotify,
  type NotifyGroup,
  type NotifyPrefs,
} from '@gamemarket/shared';
import { MailService } from '../mail/mail.service';
import { TelegramService, type TgButton } from './telegram.service';
import { PushService, type PushMessage } from './push.service';
import { langOf, notifyLabel, say } from '../../i18n/texts';
import type { Lang } from '../../i18n/lang';

/**
 * Превью уведомления — слова людей или название лота; скрытый контакт в нём
 * API помечает по-русски, получателю метка — на его языке. Причина отказа в
 * выводе, выбранная сотрудником из подсказок слово в слово, — переводом.
 */
const shown = (lang: Lang, text: string) => {
  if (lang === 'en' && isPayoutRejectReason(text)) return EN_SHARED[text] ?? text;
  return text.includes(HIDDEN_MARK) ? text.split(HIDDEN_MARK).join(say(lang, HIDDEN_MARK)) : text;
};

/**
 * Темы писем для важных событий; для остальных — подпись из shared/notify.ts.
 * Перевод — в i18n/texts.ts, письмо уходит на языке получателя.
 */
export const EMAIL_SUBJECTS: Record<string, string> = {
  order_paid: 'Новый оплаченный заказ',
  order_delivered: 'Товар по заказу выдан',
  order_refunded: 'Возврат по заказу',
  payment_to_balance: 'Оплата зачислена на баланс',
  listing_blocked: 'Лот заблокирован модератором',
  account_status: 'Статус вашего аккаунта изменён',
  payout_paid: 'Выплата отправлена',
  payout_rejected: 'Заявка на вывод отклонена',
  dispute_opened: 'Открыт спор по вашей сделке',
  dispute_reply_needed: 'Ждём вашего ответа в споре',
  dispute_resolved: 'Спор по сделке разрешён',
  review_received: 'Вы получили новый отзыв',
};

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';

/** Пуши этих групп будят телефон сразу: ждут покупатель, продавец или арбитр. */
const URGENT: Array<NotifyGroup | null> = ['orders', 'messages', 'disputes'];

/** Группы страницы «Уведомления»: сообщения живут в мессенджере, там свой счётчик. */
const HISTORY_GROUPS = NOTIFY_GROUPS.filter((g) => g.key !== 'messages');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HistoryQuery {
  group?: string;
  unread?: boolean;
  /** id последнего показанного: дальше — те, что старше него. */
  before?: string;
  limit?: number;
}

/** Страницы, у которых одно уведомление на экране: новое заменяет прежнее. */
const TAGGED = /^\/(chat|orders|disputes|cabinet\/support)\//;

export interface NotifyOptions {
  /**
   * Своя ссылка в письме вместо «Подробности»: например, «Это не я» со
   * ссылкой сброса пароля. В базу не пишется — её видит только почта.
   */
  mail?: { action: string; link: string };
}

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
  async notify(
    userId: string,
    type: string,
    payload: Prisma.InputJsonValue = {},
    opts: NotifyOptions = {},
  ) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, channel: 'in_app', payload },
    });

    // Тема письма — своя для важных событий, иначе та же подпись, что на сайте:
    // галочка «письмом» в настройках должна работать для любой группы.
    const viaMail = !!(EMAIL_SUBJECTS[type] ?? notifyLabel('ru', type)) && this.mail.enabled;
    if (!viaMail && !this.telegram.enabled && !this.push.enabled) return notification;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, telegramId: true, notifyPrefs: true, locale: true },
    });
    if (!user) return notification;
    const lang = langOf(user.locale);
    const prefs = user.notifyPrefs as NotifyPrefs | null;
    const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const link = `${WEB_URL}${notifyLink(type, data)}`;

    if (viaMail && user.email && wantsNotify(prefs, 'email', type)) {
      const subject = this.subject(lang, type)!;
      // Подробности события — те же, что в Telegram и пуше: устройство и IP
      // входа, «было — стало» у цены.
      const preview =
        typeof data.preview === 'string' && data.preview ? shown(lang, data.preview) : null;
      const action = say(lang, opts.mail?.action ?? 'Подробности');
      const href = opts.mail?.link ?? link;
      await this.mail.send(
        user.email,
        subject,
        preview
          ? say(lang, '{subject}.\n\n{preview}\n\n{action}: {link}', {
              subject,
              preview,
              action,
              link: href,
            })
          : say(lang, '{subject}.\n\n{action}: {link}', { subject, action, link: href }),
      );
    }
    if (user.telegramId && this.telegram.enabled && wantsNotify(prefs, 'telegram', type)) {
      // Не ждём: медленный Telegram не должен задерживать оплату или чат.
      void this.telegram.notify(
        { id: userId, telegramId: user.telegramId },
        this.telegramMessage(lang, type, data, link),
      );
    }
    if (this.push.enabled && wantsNotify(prefs, 'push', type))
      void this.pushTo(userId, lang, type, data);
    return notification;
  }

  /** Тема письма на языке получателя. */
  private subject(lang: Lang, type: string): string | undefined {
    const own = EMAIL_SUBJECTS[type];
    return own ? say(lang, own) : notifyLabel(lang, type);
  }

  /** Пуш на устройства пользователя. Не ждём, как и Telegram. */
  private async pushTo(userId: string, lang: Lang, type: string, data: Record<string, unknown>) {
    try {
      if (!(await this.push.devices(userId))) return;
      await this.push.send(
        userId,
        await this.pushMessage(lang, type, data),
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
  private async pushMessage(
    lang: Lang,
    type: string,
    data: Record<string, unknown>,
  ): Promise<PushMessage> {
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
      title: from
        ? say(lang, 'Сообщение от {name}', { name: from })
        : (notifyLabel(lang, type) ?? 'GameMarket'),
      body: body ? shown(lang, body) : '',
      url,
      ...(TAGGED.test(url) ? { tag: url } : {}),
    };
  }

  /**
   * Сообщение в Telegram: заголовок, подробности и ссылка. Где действие
   * короткое, — кнопка: «Отметить выдачу» у оплаченного заказа с ручной
   * выдачей и «Подтвердить получение» у выданного (бот переспросит),
   * «Ответить» и «Заготовки» у сообщения из чата — ответ на само уведомление
   * тоже уйдёт в этот диалог.
   */
  private telegramMessage(
    lang: Lang,
    type: string,
    data: Record<string, unknown>,
    link: string,
  ): { text: string; buttons?: TgButton[][]; thread?: string } {
    const title = notifyLabel(lang, type) ?? say(lang, 'Уведомление GameMarket');
    const quote = lang === 'en' ? ['“', '”'] : ['«', '»'];
    const preview =
      typeof data.preview === 'string' && data.preview
        ? `\n${quote[0]}${shown(lang, data.preview)}${quote[1]}`
        : '';
    const text = `${title}${preview}\n${link}`;
    const id = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : null);
    const orderId = id('orderId');
    if (type === 'order_paid' && orderId && data.manual === true) {
      return { text, buttons: [[{ text: say(lang, 'Отметить выдачу'), data: `dv:${orderId}` }]] };
    }
    if (type === 'order_delivered' && orderId) {
      return {
        text,
        buttons: [[{ text: say(lang, 'Подтвердить получение'), data: `cf:${orderId}` }]],
      };
    }
    const conversationId = id('conversationId');
    if (type === 'new_message' && conversationId) {
      const reply = { text: say(lang, 'Ответить'), data: `rp:${conversationId}` };
      const templates = { text: say(lang, 'Заготовки'), data: `tl:${conversationId}` };
      return {
        text,
        buttons: [data.templates === true ? [reply, templates] : [reply]],
        thread: conversationId,
      };
    }
    return { text };
  }

  /**
   * Колокольчик: всё, кроме новых сообщений. У сообщений свой счётчик в
   * шапке и свой список — в мессенджере; в колокольчике они тонули бы
   * события сделок.
   */
  listMine(userId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: { userId, type: { not: 'new_message' }, hiddenAt: null },
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

  /**
   * Страница «Уведомления»: вся история, новые сверху, с фильтром по группе
   * и «только непрочитанные». Дальше — по id последнего показанного: новые
   * уведомления, пришедшие между запросами, не сдвигают список. Рядом —
   * сколько непрочитанных в каждой группе, для фильтров, и сколько
   * прочитанных в выбранной — для «Убрать прочитанные». Убранные не видны.
   */
  async history(userId: string, q: HistoryQuery) {
    const types = this.typesOf(q.group);
    const limit = Math.min(Math.max(Math.trunc(q.limit ?? 30) || 30, 1), 100);
    let after: Prisma.NotificationWhereInput = {};
    if (q.before) {
      const last = UUID.test(q.before)
        ? await this.prisma.notification.findFirst({
            where: { id: q.before, userId },
            select: { id: true, createdAt: true },
          })
        : null;
      if (!last) throw new BadRequestException('Список уведомлений устарел — обновите страницу');
      after = {
        OR: [
          { createdAt: { lt: last.createdAt } },
          { createdAt: last.createdAt, id: { lt: last.id } },
        ],
      };
    }
    const [rows, read, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: {
          userId,
          type: types,
          hiddenAt: null,
          ...(q.unread ? { readAt: null } : {}),
          ...after,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: { id: true, type: true, payload: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({
        where: { userId, type: types, hiddenAt: null, readAt: { not: null } },
      }),
      this.unreadByGroup(userId),
    ]);
    const items = rows.slice(0, limit);
    return { items, next: rows.length > limit ? items.at(-1)!.id : null, unread, read };
  }

  /**
   * «Убрать прочитанные» — все или одной группы. Уведомление скрывается из
   * списка человека, а не удаляется: по входам, сменам пароля и почты
   * сотрудник видит историю аккаунта при восстановлении доступа, и тот, кто
   * сидит в чужом аккаунте, не сотрёт ими свои следы.
   */
  async clearRead(userId: string, group?: string) {
    const r = await this.prisma.notification.updateMany({
      where: { userId, type: this.typesOf(group), readAt: { not: null }, hiddenAt: null },
      data: { hiddenAt: new Date() },
    });
    return { removed: r.count };
  }

  /** Непрочитанные по группам и всего — без сообщений. */
  private async unreadByGroup(userId: string) {
    const byType = await this.prisma.notification.groupBy({
      by: ['type'],
      where: { userId, readAt: null, type: { not: 'new_message' } },
      _count: { _all: true },
    });
    const groups: Partial<Record<NotifyGroup, number>> = {};
    let total = 0;
    for (const r of byType) {
      const group = notifyGroupOf(r.type);
      total += r._count._all;
      if (group) groups[group] = (groups[group] ?? 0) + r._count._all;
    }
    return { total, groups };
  }

  /** Условие на тип: группа страницы или всё, кроме сообщений. */
  private typesOf(group: string | undefined): Prisma.StringFilter {
    if (!group) return { not: 'new_message' };
    const found = HISTORY_GROUPS.find((g) => g.key === group);
    if (!found) throw new BadRequestException('Нет такой группы уведомлений');
    return { in: [...found.types] };
  }

  /** «Прочитать все» — всё, кроме сообщений, или только выбранную группу. */
  async markAllRead(userId: string, group?: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, type: this.typesOf(group) },
      data: { readAt: new Date() },
    });
    return { ok: true, unread: await this.unreadByGroup(userId) };
  }
}
