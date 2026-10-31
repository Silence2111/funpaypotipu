import { Body, Controller, ForbiddenException, Headers, HttpCode, Post } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { TelegramService, type TelegramUpdate } from './telegram.service';

/**
 * Вебхук бота. Telegram присылает секрет из setWebhook(secret_token) в
 * заголовке — без него обновления не принимаются: иначе кто угодно слал бы
 * поддельные «/start» от чужого имени.
 */
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: TelegramUpdate) {
    const want = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
    const got = Buffer.from(secret ?? '');
    if (!this.telegram.enabled || !want || got.length !== want.length || !timingSafeEqual(got, Buffer.from(want))) {
      throw new ForbiddenException();
    }
    await this.telegram.handleUpdate(update ?? {});
    return { ok: true };
  }
}
