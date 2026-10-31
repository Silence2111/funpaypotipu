import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { requestLang, type Lang } from '../../i18n/lang';
import { langOf, say } from '../../i18n/texts';

const LINK_TTL_SEC = 15 * 60;
/** Ответить на сообщение бота в чат на сайте можно неделю. */
export const REPLY_TTL_MS = 7 * 86_400_000;

/** Входящее обновление Bot API — только то, что нужно боту. */
export interface TelegramUpdate {
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id: number | string; type?: string };
    /** Язык приложения Telegram: им бот отвечает тому, кто ещё не привязан. */
    from?: { id?: number; language_code?: string };
    /** Ответ на сообщение бота: из уведомления о сообщении — в чат на сайте. */
    reply_to_message?: { message_id: number };
  };
  /** Нажатие кнопки под сообщением бота. */
  callback_query?: {
    id: string;
    from: { id: number; language_code?: string };
    message?: { message_id: number; chat: { id: number | string; type?: string } };
    data?: string;
  };
}

/** Кнопка под сообщением: data уходит боту при нажатии (до 64 байт). */
export interface TgButton {
  text: string;
  data: string;
}

/** Что бот отвечает на нажатие или ответ. */
export interface TgAnswer {
  text: string;
  buttons?: TgButton[][];
  /** Заменить сообщение с нажатой кнопкой, а не прислать новое. */
  replace?: boolean;
  /** Сразу открыть ответ на это сообщение. */
  forceReply?: boolean;
  /** Ответ на это сообщение уйдёт в этот диалог на сайте. */
  thread?: string;
}

export interface TgUser {
  id: string;
  locale: string | null;
}

/**
 * Действия из Telegram — их выполняет модуль, которому доступны заказы и
 * чат; бот о заказах не знает и только передаёт нажатия и ответы.
 */
export interface TelegramActions {
  /** thread — диалог сообщения с кнопкой, если оно из чата (список заготовок). */
  press(user: TgUser, data: string, lang: Lang, thread?: string): Promise<TgAnswer>;
  reply(user: TgUser, conversationId: string, text: string, lang: Lang): Promise<TgAnswer>;
}

/**
 * Telegram-бот уведомлений. Привязка — по ссылке t.me/<бот>?start=<код>:
 * код подписан сервером и живёт 15 минут, хранить его не нужно. Без
 * TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME бот выключен, вызовы — no-op.
 *
 * Под уведомлениями — кнопки действий («Подтвердить получение», «Ответить»),
 * а на уведомление о сообщении можно ответить — текст уйдёт в чат на сайте.
 * Действует только тот, чей это Telegram: нажатие и ответ приходят из его
 * личного чата с ботом, а вебхук закрыт секретом.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  readonly botUsername = (process.env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '');

  private actions: TelegramActions | null = null;

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  get enabled(): boolean {
    return !!this.token && !!this.botUsername;
  }

  /** Кто выполняет нажатия и ответы — модуль заказов и чата при запуске. */
  useActions(actions: TelegramActions) {
    this.actions = actions;
  }

  /** Bot API; подмена адреса — только вне боя, для тестового сервера. */
  private get api(): string {
    const test = process.env.NODE_ENV !== 'production' ? process.env.TELEGRAM_API_URL : undefined;
    return (test ?? 'https://api.telegram.org').replace(/\/$/, '');
  }

  /** Вызов Bot API: ответ result или null — не дошло (бот заблокирован, сеть). */
  private async call(method: string, body: Record<string, unknown>, chatId?: string) {
    if (!this.enabled) return null;
    try {
      const res = await fetch(`${this.api}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      // Пользователь остановил бота — уведомлять больше некуда, привязка снимается.
      if (res.status === 403 && chatId) {
        await this.prisma.user.updateMany({ where: { telegramId: chatId }, data: { telegramId: null } });
        return null;
      }
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as { result?: unknown } | null;
      return json?.result ?? true;
    } catch (e) {
      this.logger.warn(`Telegram: ${method} в ${chatId ?? '—'}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Сообщение с кнопками; номер сообщения в чате или null — не дошло. */
  private async post(chatId: string, text: string, markup?: Record<string, unknown>) {
    const result = await this.call(
      'sendMessage',
      { chat_id: chatId, text, disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) },
      chatId,
    );
    const id = (result as { message_id?: unknown } | null)?.message_id;
    return typeof id === 'number' ? id : result ? 0 : null;
  }

  /** Отправить сообщение. false — не дошло (бот заблокирован, сеть). */
  async send(chatId: string, text: string): Promise<boolean> {
    return (await this.post(chatId, text)) !== null;
  }

  /**
   * Уведомление: с кнопками, а у сообщения из чата — с ответом в этот диалог:
   * номер сообщения запоминается за пользователем и диалогом.
   */
  async notify(
    user: { id: string; telegramId: string },
    msg: { text: string; buttons?: TgButton[][]; thread?: string },
  ): Promise<boolean> {
    const id = await this.post(user.telegramId, msg.text, keyboard(msg.buttons));
    if (id && msg.thread) await this.remember(user.telegramId, id, user.id, msg.thread);
    return id !== null;
  }

  /** Запомнить сообщение, ответ на которое уйдёт в диалог; старше недели — забыть. */
  private async remember(chatId: string, messageId: number, userId: string, conversationId: string) {
    await this.prisma.telegramReply.upsert({
      where: { chatId_messageId: { chatId, messageId } },
      create: { chatId, messageId, userId, conversationId },
      update: { userId, conversationId },
    });
    await this.prisma.telegramReply.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - REPLY_TTL_MS) } },
    });
  }

  // ── Код привязки: uuid (22) + срок (7) + подпись (16) = 45 символов [A-Za-z0-9_-] ──

  linkUrl(userId: string, now = Date.now()): string {
    return `https://t.me/${this.botUsername}?start=${this.linkCode(userId, now)}`;
  }

  linkCode(userId: string, now = Date.now()): string {
    const id = Buffer.from(userId.replace(/-/g, ''), 'hex').toString('base64url');
    const exp = Math.floor(now / 1000 + LINK_TTL_SEC).toString(36).padStart(7, '0');
    return id + exp + this.sign(id + exp);
  }

  /** userId из кода или null — подделка или истёк срок. */
  parseLinkCode(code: string, now = Date.now()): string | null {
    if (!/^[A-Za-z0-9_-]{45}$/.test(code)) return null;
    const id = code.slice(0, 22);
    const exp = code.slice(22, 29);
    const sig = Buffer.from(code.slice(29));
    const want = Buffer.from(this.sign(id + exp));
    if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
    if (parseInt(exp, 36) * 1000 < now) return null;
    const hex = Buffer.from(id, 'base64url').toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private sign(data: string): string {
    const secret = process.env.JWT_ACCESS_SECRET ?? 'dev-telegram-link';
    return createHmac('sha256', `tg-link:${secret}`).update(data).digest('base64url').slice(0, 16);
  }

  // ── Обновления от Telegram (вебхук) ──

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) return this.onPress(update.callback_query);
    const chat = update.message?.chat;
    if (!chat || (chat.type && chat.type !== 'private')) return;
    const chatId = String(chat.id);
    // Привязанному — на языке профиля, остальным — на языке Telegram.
    const owner = await this.owner(chatId);
    const holder = owner && owner.status !== 'banned' ? owner : null;
    const lang = owner ? langOf(owner.locale) : requestLang(update.message?.from?.language_code);
    const replyTo = update.message?.reply_to_message?.message_id;
    if (holder && replyTo !== undefined && (await this.onReply(chatId, holder, replyTo, update.message?.text, lang))) {
      return;
    }
    const text = update.message?.text?.trim();
    if (!text) return;
    const [cmd, arg] = text.split(/\s+/, 2);

    // Чат заблокированного тоже занят: привязать его к другому аккаунту нельзя.
    if (cmd === '/start' && arg) return this.link(chatId, arg, owner?.id ?? null, lang);
    if (cmd === '/stop') {
      await this.prisma.user.updateMany({ where: { telegramId: chatId }, data: { telegramId: null } });
      await this.send(chatId, say(lang, 'Уведомления отключены. Подключить снова — в настройках профиля на сайте.'));
      return;
    }
    await this.send(
      chatId,
      say(
        lang,
        'Это бот уведомлений GameMarket. Чтобы подключить его, откройте на сайте Профиль → Уведомления и нажмите «Подключить Telegram».',
      ),
    );
  }

  /** Кто привязал этот чат. */
  private owner(chatId: string) {
    return this.prisma.user.findUnique({
      where: { telegramId: chatId },
      select: { id: true, locale: true, status: true },
    });
  }

  /**
   * Нажатие кнопки. Только в личном чате того, чей это Telegram: кнопку
   * чужого сообщения нажать нельзя, но данные кнопки всё равно не верим —
   * заказ и диалог проверяет тот, кто выполняет действие.
   */
  private async onPress(q: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
    // Без ответа Telegram крутит на кнопке часики.
    await this.call('answerCallbackQuery', { callback_query_id: q.id });
    const chatId = String(q.message?.chat.id ?? '');
    if (!q.message || chatId !== String(q.from.id)) return;
    const owner = await this.owner(chatId);
    // Заблокированный действовать не может — как и на сайте.
    const holder = owner && owner.status !== 'banned' ? owner : null;
    const lang = holder ? langOf(holder.locale) : requestLang(q.from.language_code);
    if (!holder) {
      await this.send(
        chatId,
        say(lang, 'Этот Telegram не подключён к аккаунту GameMarket. Подключить — в настройках на сайте.'),
      );
      return;
    }
    if (!this.actions || !q.data) return;
    const thread = (await this.threadOf(chatId, q.message.message_id, holder.id)) ?? undefined;
    const out = await this.actions.press(holder, q.data, lang, thread);
    await this.answer(chatId, holder.id, out, q.message.message_id);
  }

  /** Ответ на сообщение бота — в чат на сайте; false — это не такое сообщение. */
  private async onReply(
    chatId: string,
    holder: TgUser,
    messageId: number,
    text: string | undefined,
    lang: Lang,
  ): Promise<boolean> {
    const conversationId = await this.threadOf(chatId, messageId, holder.id);
    if (!conversationId) return false;
    if (!text?.trim()) {
      await this.send(chatId, say(lang, 'Отправить можно только текст: фото и файлы — в чате на сайте.'));
      return true;
    }
    if (!this.actions) return false;
    await this.answer(chatId, holder.id, await this.actions.reply(holder, conversationId, text.trim(), lang));
    return true;
  }

  /** Диалог, к которому относится сообщение бота в этом чате, — если оно этого пользователя и не старше недели. */
  private async threadOf(chatId: string, messageId: number, userId: string) {
    const ref = await this.prisma.telegramReply.findUnique({
      where: { chatId_messageId: { chatId, messageId } },
    });
    if (!ref || ref.userId !== userId || ref.createdAt.getTime() < Date.now() - REPLY_TTL_MS) {
      return null;
    }
    return ref.conversationId;
  }

  /** Ответ бота: заменить сообщение с кнопкой или прислать новое (с ответом в диалог). */
  private async answer(chatId: string, userId: string, out: TgAnswer, pressedId?: number) {
    if (out.replace && pressedId !== undefined) {
      await this.call(
        'editMessageText',
        {
          chat_id: chatId,
          message_id: pressedId,
          text: out.text,
          disable_web_page_preview: true,
          ...(out.buttons ? { reply_markup: keyboard(out.buttons) } : {}),
        },
        chatId,
      );
      return;
    }
    const markup = out.forceReply ? { force_reply: true } : keyboard(out.buttons);
    const id = await this.post(chatId, out.text, markup);
    if (id && out.thread) await this.remember(chatId, id, userId, out.thread);
  }

  private async link(chatId: string, code: string, holderId: string | null, lang: Lang): Promise<void> {
    const userId = this.parseLinkCode(code);
    if (!userId) {
      await this.send(chatId, say(lang, 'Ссылка устарела. Нажмите «Подключить Telegram» в настройках на сайте ещё раз.'));
      return;
    }
    if (holderId && holderId !== userId) {
      await this.send(
        chatId,
        say(
          lang,
          'Этот Telegram уже подключён к другому аккаунту GameMarket. Отключите его там — командой /stop или в настройках.',
        ),
      );
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, locale: true } });
    if (!user || user.status === 'banned') {
      await this.send(chatId, say(lang, 'Аккаунт не найден.'));
      return;
    }
    await this.prisma.user.update({ where: { id: userId }, data: { telegramId: chatId } });
    await this.send(
      chatId,
      say(
        langOf(user.locale),
        'Готово: уведомления GameMarket будут приходить сюда. Отключить — командой /stop или в настройках на сайте.',
      ),
    );
  }
}

/** Кнопки под сообщением в формате Bot API. */
function keyboard(buttons?: TgButton[][]) {
  return buttons?.length
    ? { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) }
    : undefined;
}
