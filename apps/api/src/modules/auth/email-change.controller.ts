import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { ctxOf } from './auth-http';
import { EmailChangeService } from './email-change.service';

const requestSchema = z.object({
  email: z.string().trim().email('Проверьте адрес почты').max(200),
  password: z.string().max(128).optional(),
  code: z.string().trim().max(20).optional(),
});
const tokenSchema = z.object({ token: z.string().min(10).max(2000) });
const revertSchema = tokenSchema.extend({
  password: z.string().min(8, 'Новый пароль — от 8 символов').max(128),
});

/** Смена почты: просьба из «Безопасности», ссылка на новую почту и «Это не я» со старой. */
@Controller('auth/email')
export class EmailChangeController {
  constructor(private readonly emails: EmailChangeService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @RateLimit('email-change', 10, 3600)
  request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(requestSchema))
    body: { email: string; password?: string; code?: string },
    @Req() req: Request,
  ) {
    return this.emails.request(user.userId, body, ctxOf(req));
  }

  @Post('confirm')
  @HttpCode(200)
  @RateLimit('email-link', 60, 3600)
  confirm(@Body(new ZodValidationPipe(tokenSchema)) body: { token: string }) {
    return this.emails.confirm(body.token);
  }

  @Post('revert/status')
  @HttpCode(200)
  @RateLimit('email-link', 60, 3600)
  revertStatus(@Body(new ZodValidationPipe(tokenSchema)) body: { token: string }) {
    return this.emails.revertStatus(body.token);
  }

  @Post('revert')
  @HttpCode(200)
  @RateLimit('email-link', 60, 3600)
  revert(@Body(new ZodValidationPipe(revertSchema)) body: { token: string; password: string }) {
    return this.emails.revert(body.token, body.password);
  }
}
