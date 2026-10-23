import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  loginSchema,
  registerSchema,
  type AuthResponse,
  type LoginInput,
  type RegisterInput,
} from '@gamemarket/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE, REFRESH_PATH, completeLogin, ctxOf } from './auth-http';
import { TwoFactorService } from './twofactor.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { RateLimit } from '../../common/rate-limit';

// Код из приложения — 6 цифр, резервный — «abcde-fghjk».
const codeSchema = z.object({ code: z.string().trim().min(6).max(20) });
const passwordSchema = z.object({
  // Нет у аккаунта, заведённого через сервис: там пароль задают впервые.
  current: z.string().optional(),
  // Те же правила, что при регистрации.
  next: z.string().min(8, 'Новый пароль — от 8 символов').max(128),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Post('register')
  @RateLimit('auth-register', 10, 3600)
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(
    @Body() body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.complete(await this.auth.register(body, ctxOf(req)), res);
  }

  @Post('login')
  @RateLimit('auth-login', 30, 600)
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.complete(await this.auth.login(body, ctxOf(req)), res);
  }

  @Post('forgot')
  @RateLimit('auth-forgot', 5, 900)
  @HttpCode(200)
  async forgot(
    @Body(new ZodValidationPipe(z.object({ email: z.string().email() }))) body: { email: string },
    @Req() req: Request,
  ) {
    await this.auth.requestPasswordReset(body.email, ctxOf(req).lang);
    return { ok: true };
  }

  @Post('reset')
  @RateLimit('auth-reset', 10, 900)
  @HttpCode(200)
  async reset(
    @Body(new ZodValidationPipe(z.object({ token: z.string().min(10), password: z.string().min(8).max(200) })))
    body: { token: string; password: string },
    @Req() req: Request,
  ) {
    await this.auth.resetPassword(body.token, body.password, ctxOf(req));
    return { ok: true };
  }

  @Post('verify-email')
  @RateLimit('auth-verify', 20, 900)
  @HttpCode(200)
  async verifyEmail(
    @Body(new ZodValidationPipe(z.object({ token: z.string().min(10) }))) body: { token: string },
  ) {
    await this.auth.verifyEmail(body.token);
    return { ok: true };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    return this.complete(await this.auth.refresh(token ?? '', ctxOf(req)), res);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    await this.auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  }

  // ── Пароль и сеансы ──
  @Post('password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(passwordSchema)) body: { current?: string; next: string },
    @Req() req: Request,
  ) {
    return this.auth.changePassword(user.userId, body.current, body.next, user.sessionFamily, ctxOf(req));
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.sessions(user.userId, user.sessionFamily);
  }

  @Post('sessions/:id/revoke')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.auth.revokeSession(user.userId, id, user.sessionFamily);
  }

  /** «Это не я» из предупреждения о входе: завершить сеанс и забыть устройство. */
  @Post('sessions/:id/not-me')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  denySession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.auth.denySession(user.userId, id, user.sessionFamily);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  revokeOthers(@CurrentUser() user: AuthUser) {
    return this.auth.revokeOtherSessions(user.userId, user.sessionFamily);
  }

  /** Кто я и мои роли — консоль сотрудника показывает только свои разделы. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    return { ...user, roles: await this.auth.rolesOf(user.userId) };
  }

  // ── Двухфакторная аутентификация ──
  @Get('2fa')
  @UseGuards(JwtAuthGuard)
  twoFactorStatus(@CurrentUser() user: AuthUser) {
    return this.twoFactor.status(user.userId);
  }

  @Post('2fa/setup')
  @RateLimit('auth-2fa', 20, 600)
  @UseGuards(JwtAuthGuard)
  setup2fa(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user.userId, user.username);
  }

  @Post('2fa/enable')
  @RateLimit('auth-2fa', 20, 600)
  @UseGuards(JwtAuthGuard)
  enable2fa(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(codeSchema)) body: { code: string },
  ) {
    return this.twoFactor.enable(user.userId, body.code);
  }

  @Post('2fa/disable')
  @RateLimit('auth-2fa', 20, 600)
  @UseGuards(JwtAuthGuard)
  disable2fa(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(codeSchema)) body: { code: string },
  ) {
    return this.twoFactor.disable(user.userId, body.code);
  }

  /** Новые резервные коды взамен старых — по коду из приложения. */
  @Post('2fa/recovery')
  @RateLimit('auth-2fa', 20, 600)
  @UseGuards(JwtAuthGuard)
  regenerate2fa(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(codeSchema)) body: { code: string },
  ) {
    return this.twoFactor.regenerate(user.userId, body.code);
  }

  private complete = completeLogin;
}
