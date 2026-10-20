import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import type { AuthResponse } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../current-user.decorator';
import { completeLogin, ctxOf } from '../auth-http';
import {
  LINK_COOKIE,
  SOCIAL_PATH,
  SOCIAL_TTL,
  STATE_COOKIE,
  STATE_PATH,
  SocialService,
  TICKET_COOKIE,
} from './social.service';
import { RateLimit } from '../../../common/rate-limit';

const webUrl = () => (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const cookie = (path: string): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path,
  maxAge: SOCIAL_TTL * 1000,
});

// Данные виджета Telegram: id, имя, ник, фото, время, подпись — и всё, что
// Telegram добавит потом: подпись проверяется по всем полям.
const telegramSchema = z
  .record(z.union([z.string().max(512), z.number()]))
  .refine((d) => Object.keys(d).length <= 16, 'Слишком много полей');
const completeSchema = z.object({
  code: z.string().trim().max(20).optional(),
  username: z.string().trim().max(32).optional(),
});

const cookies = (req: Request) => (req.cookies ?? {}) as Record<string, string | undefined>;

/** Вход через Telegram, VK и Google, подключение и отключение сервисов. */
@Controller('auth')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  /** Какие сервисы подключены — какие кнопки показать на входе. */
  @Get('social')
  providers() {
    return this.social.providers();
  }

  /** Подключить сервис к аккаунту: намерение — в cookie этого браузера, не в ссылке. */
  @Post('social/link-intent')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  linkIntent(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    res.cookie(LINK_COOKIE, this.social.linkCookie(user.userId), cookie(SOCIAL_PATH));
    return { ok: true };
  }

  @Get('oauth/:provider/start')
  @RateLimit('auth-oauth', 30, 600)
  start(
    @Param('provider') provider: string,
    @Query('next') next: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const { url, stateCookie } = this.social.start(provider, next, cookies(req)[LINK_COOKIE]);
      res.cookie(STATE_COOKIE, stateCookie, cookie(STATE_PATH));
      res.clearCookie(LINK_COOKIE, { path: SOCIAL_PATH });
      res.redirect(302, url);
    } catch {
      res.redirect(302, `${webUrl()}/login?social_error=disabled`);
    }
  }

  @Get('oauth/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const r = await this.social.callback(provider, query, cookies(req)[STATE_COOKIE]);
    res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
    if (r.ticket) res.cookie(TICKET_COOKIE, r.ticket, cookie(SOCIAL_PATH));
    res.redirect(302, r.redirect);
  }

  @Post('social/telegram')
  @RateLimit('auth-oauth', 30, 600)
  @HttpCode(200)
  telegram(
    @Body(new ZodValidationPipe(telegramSchema)) data: Record<string, string | number>,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.cookie(TICKET_COOKIE, this.social.telegramTicket(data), cookie(SOCIAL_PATH));
    return { ok: true };
  }

  @Post('social/telegram/link')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  linkTelegram(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(telegramSchema)) data: Record<string, string | number>,
  ) {
    return this.social.linkTelegram(user.userId, data);
  }

  /** Завершить вход по билету: ник для нового аккаунта, код — если включена защита. */
  @Post('social/complete')
  @RateLimit('auth-social', 20, 600)
  @HttpCode(200)
  async complete(
    @Body(new ZodValidationPipe(completeSchema)) body: { code?: string; username?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const issued = await this.social.complete(cookies(req)[TICKET_COOKIE], body, ctxOf(req));
    res.clearCookie(TICKET_COOKIE, { path: SOCIAL_PATH });
    return completeLogin(issued, res);
  }

  @Get('social/accounts')
  @UseGuards(JwtAuthGuard)
  accounts(@CurrentUser() user: AuthUser) {
    return this.social.accounts(user.userId);
  }

  @Delete('social/:provider')
  @UseGuards(JwtAuthGuard)
  unlink(@CurrentUser() user: AuthUser, @Param('provider') provider: string) {
    return this.social.unlink(user.userId, provider);
  }
}
