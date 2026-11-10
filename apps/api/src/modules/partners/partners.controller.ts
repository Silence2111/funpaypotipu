import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { PARTNER_MAX_SHARE_BPS, PARTNER_MAX_TERM_DAYS, type PartnerSettings } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { PartnersService } from './partners.service';

const codeSchema = z.object({ code: z.string().trim().min(1).max(32) });
const settingsSchema = z.object({
  enabled: z.boolean(),
  shareBps: z.number().int().min(0).max(PARTNER_MAX_SHARE_BPS, 'Доля партнёра — не больше 50%'),
  termDays: z.number().int().min(0).max(PARTNER_MAX_TERM_DAYS, 'Срок — не больше 3650 дней'),
});

/** Партнёрская программа (часть 116): условия, кабинет, переход и привязка. */
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  /** Работает ли программа — сайту, без входа. */
  @Get('program')
  program() {
    return this.partners.program();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.partners.me(user.userId);
  }

  /** Переход по ссылке: счётчик дня. Без входа — по ссылке приходят гости. */
  @Post('click')
  @RateLimit('partner-click', 60, 3600)
  click(@Body(new ZodValidationPipe(codeSchema)) body: { code: string }) {
    return this.partners.click(body.code);
  }

  /** Привязка к партнёру в первые сутки после регистрации. */
  @Post('attach')
  @UseGuards(JwtAuthGuard)
  @RateLimit('partner-attach', 20, 3600)
  attach(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(codeSchema)) body: { code: string }, @Req() req: Request) {
    return this.partners.attach(user.userId, body.code, { ip: req.ip ?? null });
  }
}

/** Условия программы — только администратору; изменения — в журнале. */
@Controller('admin/partner-program')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PartnersAdminController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  view() {
    return this.partners.adminView();
  }

  @Put()
  set(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(settingsSchema)) body: PartnerSettings) {
    return this.partners.setSettings(user.userId, body);
  }
}
