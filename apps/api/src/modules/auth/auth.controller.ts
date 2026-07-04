import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { AuthService, type IssuedAuth, type RequestCtx } from './auth.service';
import { TwoFactorService } from './twofactor.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthUser } from './current-user.decorator';

const codeSchema = z.object({ code: z.string().min(6).max(8) });

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Post('register')
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(
    @Body() body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.complete(await this.auth.register(body, ctxOf(req)), res);
  }

  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.complete(await this.auth.login(body, ctxOf(req)), res);
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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  // ── Двухфакторная аутентификация ──
  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  setup2fa(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user.userId, user.username);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  enable2fa(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(codeSchema)) body: { code: string },
  ) {
    return this.twoFactor.enable(user.userId, body.code);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  disable2fa(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(codeSchema)) body: { code: string },
  ) {
    return this.twoFactor.disable(user.userId, body.code);
  }

  /** Refresh — в httpOnly cookie, access — в теле ответа. */
  private complete(issued: IssuedAuth, res: Response): AuthResponse {
    res.cookie(REFRESH_COOKIE, issued.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_PATH,
      maxAge: Number(process.env.JWT_REFRESH_TTL ?? 2592000) * 1000,
    });
    return { user: issued.user, accessToken: issued.accessToken };
  }
}

function ctxOf(req: Request): RequestCtx {
  return {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
    fingerprint: (req.headers['x-device-fingerprint'] as string | undefined) ?? undefined,
  };
}
