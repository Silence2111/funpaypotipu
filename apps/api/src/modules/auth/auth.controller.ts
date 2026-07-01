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
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthService, type IssuedAuth, type RequestCtx } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthUser } from './current-user.decorator';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
