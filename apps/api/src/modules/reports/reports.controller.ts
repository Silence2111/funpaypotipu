import { Controller, Get, Headers, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { RateLimit } from '../../common/rate-limit';
import { requestLang } from '../../i18n/lang';
import { ReportsService } from './reports.service';

/** Файл для Excel: имя — латиницей, чтобы его не исказил ни один браузер. */
function sendCsv(res: Response, file: { csv: string; name: string }) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  return file.csv;
}

/**
 * Отчёты. Период — `from` и `to` (ГГГГ-ММ-ДД, по Москве, оба дня
 * включительно), без них — последние 30 дней. Файлы — CSV, который Excel
 * открывает двойным щелчком; язык файла — язык сайта.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard)
@RateLimit('reports', 60, 60)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Выписка по балансу: остатки, обороты, продажи за период и операции. */
  @Get('statement')
  statement(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.statement(user.userId, this.reports.period(from, to));
  }

  @Get('statement.csv')
  async statementCsv(
    @CurrentUser() user: AuthUser,
    @Headers('accept-language') lang: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const p = this.reports.period(from, to);
    return sendCsv(res, await this.reports.statementCsv(user.userId, p, requestLang(lang)));
  }

  /** Продажи за период — для учёта дохода (самозанятому — для «Мой налог»). */
  @Get('sales.csv')
  async salesCsv(
    @CurrentUser() user: AuthUser,
    @Headers('accept-language') lang: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const p = this.reports.period(from, to);
    return sendCsv(res, await this.reports.salesCsv(user.userId, p, requestLang(lang)));
  }

  /** Сводка площадки за последние `days` дней — владельцу и финансам. */
  @Get('platform')
  @UseGuards(RolesGuard)
  @Roles('finance')
  platform(@Query('days') days?: string) {
    return this.reports.platform(this.reports.platformPeriod(Number(days ?? 30)));
  }

  @Get('platform.csv')
  @UseGuards(RolesGuard)
  @Roles('finance')
  async platformCsv(
    @Headers('accept-language') lang: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query('days') days?: string,
  ) {
    const p = this.reports.platformPeriod(Number(days ?? 30));
    return sendCsv(res, await this.reports.platformCsv(p, requestLang(lang)));
  }
}
