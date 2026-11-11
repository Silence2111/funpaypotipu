import { Body, Controller, Delete, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthResponse } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { completeLogin, ctxOf } from './auth-http';
import { PhoneService } from './phone.service';

const phone = z.string().trim().min(5, 'Укажите номер телефона').max(32);
const code = z.string().trim().min(4, 'Введите код из SMS').max(8);
const startSchema = z.object({ phone });
const verifySchema = z.object({ phone, code });
const completeSchema = z.object({
  ticket: z.string().min(10).max(2000),
  // Код из приложения-аутентификатора — у аккаунта с входом по коду.
  code: z.string().trim().max(20).optional(),
  restore: z.boolean().optional(),
  username: z.string().trim().max(24).optional(),
  pdConsent: z.boolean().optional(),
});

/**
 * Вход по номеру телефона (часть 121): /auth/phone/* — без входа,
 * /account/phone — привязка номера в «Безопасности».
 */
@Controller()
export class PhoneController {
  constructor(private readonly phones: PhoneService) {}

  /** Работает ли вход по телефону: на проде без провайдера SMS — нет. */
  @Get('auth/phone/config')
  config() {
    return this.phones.config();
  }

  @Post('auth/phone/start')
  @HttpCode(200)
  @RateLimit('auth-phone', 10, 3600)
  start(@Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>, @Req() req: Request) {
    return this.phones.start(body.phone, 'login', ctxOf(req));
  }

  @Post('auth/phone/verify')
  @HttpCode(200)
  @RateLimit('auth-phone-verify', 30, 600)
  verify(@Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>) {
    return this.phones.verify(body.phone, body.code);
  }

  @Post('auth/phone/complete')
  @HttpCode(200)
  @RateLimit('auth-phone-verify', 30, 600)
  async complete(
    @Body(new ZodValidationPipe(completeSchema)) body: z.infer<typeof completeSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return completeLogin(await this.phones.complete(body.ticket, body, ctxOf(req)), res);
  }

  /** Последнее SMS — только для e2e с заглушкой (`SMS_TEST_INBOX=1`), на проде — 404. */
  @Get('auth/phone/test-inbox')
  testInbox(@Query('phone') p: string) {
    return this.phones.testInbox(p ?? '');
  }

  @Get('account/phone')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: AuthUser) {
    return this.phones.status(user.userId);
  }

  @Post('account/phone/start')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @RateLimit('auth-phone', 10, 3600)
  linkStart(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>,
    @Req() req: Request,
  ) {
    return this.phones.start(body.phone, 'link', ctxOf(req), user.userId);
  }

  @Post('account/phone')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @RateLimit('auth-phone-verify', 30, 600)
  link(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>) {
    return this.phones.link(user.userId, body.phone, body.code);
  }

  @Delete('account/phone')
  @UseGuards(JwtAuthGuard)
  unlink(@CurrentUser() user: AuthUser) {
    return this.phones.unlink(user.userId);
  }
}
