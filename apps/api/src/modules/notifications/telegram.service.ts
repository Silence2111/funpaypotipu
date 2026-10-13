import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

const LINK_TTL_SEC = 15 * 60;

/** Входящее обновление Bot API — только то, что нужно для привязки. */
export interface TelegramUpdate {
  message?: { text?: string; chat?: { id: number | string; type?: string } };
}

/**
 * Telegram-бот уведомлений. Привязка — по ссылке t.me/<бот>?start=<код>:
 * код подписан сервером и живёт 15 минут, хранить его не нужно. Без
 * TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME бот выключен, вызовы — no-op.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  readonly botUsername = (process.env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '');

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  get enabled(): boolean {
    return !!this.token && !!this.botUsername;
  }

  /** Отправить сообщение. false — не дошло (бот заблокирован, сеть). */
  async send(chatId: string, text: string): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(5000),
      });
      // Пользователь остановил бота — уведомлять больше некуда, привязка снимается.
      if (res.status === 403) {
        await this.prisma.user.updateMany({ where: { telegramId: chatId }, data: { telegramId: null } });
        return false;
      }
      return res.ok;
    } catch (e) {
      this.logger.warn(`Telegram: не отправлено в ${chatId}: ${(e as Error).message}`);
      return false;
    }
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
    const chat = update.message?.chat;
    const text = update.message?.text?.trim();
    if (!chat || !text || (chat.type && chat.type !== 'private')) return;
    const chatId = String(chat.id);
    const [cmd, arg] = text.split(/\s+/, 2);

    if (cmd === '/start' && arg) return this.link(chatId, arg);
    if (cmd === '/stop') {
      await this.prisma.user.updateMany({ where: { telegramId: chatId }, data: { telegramId: null } });
      await this.send(chatId, 'Уведомления отключены. Подключить снова — в настройках профиля на сайте.');
      return;
    }
    await this.send(
      chatId,
      'Это бот уведомлений GameMarket. Чтобы подключить его, откройте на сайте Профиль → Уведомления и нажмите «Подключить Telegram».',
    );
  }

  private async link(chatId: string, code: string): Promise<void> {
    const userId = this.parseLinkCode(code);
    if (!userId) {
      await this.send(chatId, 'Ссылка устарела. Нажмите «Подключить Telegram» в настройках на сайте ещё раз.');
      return;
    }
    const holder = await this.prisma.user.findUnique({ where: { telegramId: chatId }, select: { id: true } });
    if (holder && holder.id !== userId) {
      await this.send(chatId, 'Этот Telegram уже подключён к другому аккаунту GameMarket. Отключите его там — командой /stop или в настройках.');
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status === 'banned') {
      await this.send(chatId, 'Аккаунт не найден.');
      return;
    }
    await this.prisma.user.update({ where: { id: userId }, data: { telegramId: chatId } });
    await this.send(chatId, 'Готово: уведомления GameMarket будут приходить сюда. Отключить — командой /stop или в настройках на сайте.');
  }
}
