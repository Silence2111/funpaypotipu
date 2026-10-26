import { HttpException, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import {
  TelegramService,
  type TelegramActions,
  type TgAnswer,
  type TgUser,
} from '../notifications/telegram.service';
import { OrdersService } from '../orders/orders.service';
import { ChatService } from '../chat/chat.service';
import { say } from '../../i18n/texts';
import { toEnglish } from '../../i18n/translate';
import type { Lang } from '../../i18n/lang';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Как на сайте: длиннее сообщение в чат не принимается. */
const MAX_TEXT = 4000;

/**
 * Действия из Telegram — те же, что на сайте, и с теми же проверками:
 * подтвердить получение может только покупатель выданного заказа, ответить —
 * только участник диалога (с чёрным списком и скрытием контактов, как в
 * чате). Подтверждение — с переспросом: деньги уходят продавцу, а вернуть их
 * можно только через спор.
 */
@Injectable()
export class TelegramActionsService implements TelegramActions, OnModuleInit {
  private readonly logger = new Logger(TelegramActionsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly telegram: TelegramService,
    private readonly orders: OrdersService,
    private readonly chat: ChatService,
  ) {}

  onModuleInit() {
    this.telegram.useActions(this);
  }

  /** Нажатие кнопки: cf — спросить, cy — подтвердить, cn — передумал, rp — ответить. */
  async press(user: TgUser, data: string, lang: Lang): Promise<TgAnswer> {
    const [kind, id] = data.split(':', 2);
    if (!id || !UUID.test(id)) return { text: say(lang, 'Кнопка устарела — откройте сайт.') };
    if (kind === 'rp') return this.askReply(user, id, lang);
    if (kind === 'cf' || kind === 'cy' || kind === 'cn') return this.confirm(kind, user, id, lang);
    return { text: say(lang, 'Кнопка устарела — откройте сайт.') };
  }

  /** Ответ в Telegram на сообщение из чата — в этот диалог на сайте. */
  async reply(user: TgUser, conversationId: string, text: string, lang: Lang): Promise<TgAnswer> {
    if (text.length > MAX_TEXT) {
      return { text: say(lang, 'Сообщение длинное — до 4000 символов.') };
    }
    try {
      await this.chat.sendMessage(conversationId, user.id, text);
    } catch (e) {
      return { text: this.reason(e, lang) };
    }
    const name = await this.otherName(user.id, conversationId);
    return { text: say(lang, 'Отправлено в чат с {name}.', { name }) };
  }

  private async confirm(kind: 'cf' | 'cy' | 'cn', user: TgUser, id: string, lang: Lang) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { publicNumber: true, buyerId: true, status: true },
    });
    // Ответ заменяет сообщение с вопросом; на кнопку из уведомления — новое сообщение.
    const replace = kind !== 'cf';
    if (!order || order.buyerId !== user.id) {
      return { replace, text: say(lang, 'Это не ваш заказ') };
    }
    const vars = { number: order.publicNumber, link: `${this.web()}/orders/${id}` };
    if (kind === 'cn') {
      return {
        replace,
        text: say(lang, 'Хорошо, не подтверждаем. Заказ {number} ждёт вас на сайте: {link}', vars),
      };
    }
    if (order.status !== 'delivered') {
      return { replace, text: say(lang, 'Заказ {number} уже не ждёт подтверждения: {link}', vars) };
    }
    if (kind === 'cf') {
      return {
        text: say(
          lang,
          'Подтвердить получение по заказу {number}? Деньги уйдут продавцу, отменить это будет нельзя. Если с товаром что-то не так — откройте спор на сайте: {link}',
          vars,
        ),
        buttons: [
          [
            { text: say(lang, 'Да, подтвердить'), data: `cy:${id}` },
            { text: say(lang, 'Нет'), data: `cn:${id}` },
          ],
        ],
      };
    }
    try {
      await this.orders.confirm(id, user.id);
    } catch (e) {
      return { replace, text: this.reason(e, lang) };
    }
    return {
      replace,
      text: say(
        lang,
        'Получение подтверждено: заказ {number} завершён, деньги ушли продавцу. Оцените сделку на сайте: {link}',
        vars,
      ),
    };
  }

  private async askReply(user: TgUser, conversationId: string, lang: Lang): Promise<TgAnswer> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { buyerId: true, sellerId: true },
    });
    if (!conv || (conv.buyerId !== user.id && conv.sellerId !== user.id)) {
      return { text: say(lang, 'Диалог не найден') };
    }
    const name = await this.otherName(user.id, conversationId);
    return {
      text: say(lang, 'Напишите ответ для {name} — он уйдёт в чат на сайте.', { name }),
      forceReply: true,
      thread: conversationId,
    };
  }

  /** Ник собеседника в диалоге. */
  private async otherName(userId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { buyerId: true, sellerId: true },
    });
    const otherId = conv?.buyerId === userId ? conv.sellerId : conv?.buyerId;
    const profile = otherId
      ? await this.prisma.profile.findUnique({
          where: { userId: otherId },
          select: { username: true },
        })
      : null;
    return profile?.username ? `@${profile.username}` : '—';
  }

  /** Причина отказа — та же, что на сайте, на языке пользователя. */
  private reason(e: unknown, lang: Lang): string {
    if (e instanceof HttpException) {
      const body = e.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      const text = Array.isArray(raw) ? String(raw[0]) : typeof raw === 'string' ? raw : null;
      if (text) return lang === 'en' ? (toEnglish(text) ?? text) : text;
    } else {
      this.logger.error(`Действие из Telegram: ${(e as Error).message}`);
    }
    return say(lang, 'Не получилось — откройте сайт.');
  }

  private web() {
    return process.env.WEB_URL ?? 'http://localhost:3000';
  }
}
