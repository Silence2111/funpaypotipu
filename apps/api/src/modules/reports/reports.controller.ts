import { Controller, Get, Headers, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { OPERATION_KIND_KEYS } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
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

const NO_KIND = 'Нет такого типа операций';
const statementQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  // Группа операций: продажи, покупки, возвраты, пополнения, выводы, продвижение.
  kind: z.enum(OPERATION_KIND_KEYS, { message: NO_KIND }).optional(),
  offset: z.coerce.number().int().min(0).max(20_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
type StatementQuery = z.infer<typeof statementQuery>;
const csvQuery = statementQuery.pick({ from: true, to: true, kind: true });
type CsvQuery = z.infer<typeof csvQuery>;

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

  /** Выписка по балансу: остатки, обороты, продажи за период и операции по страницам. */
  @Get('statement')
  statement(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(statementQuery)) q: StatementQuery,
  ) {
    return this.reports.statement(user.userId, this.reports.period(q.from, q.to), q);
  }

  @Get('statement.csv')
  async statementCsv(
    @CurrentUser() user: AuthUser,
    @Headers('accept-language') lang: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(csvQuery)) q: CsvQuery,
  ) {
    const p = this.reports.period(q.from, q.to);
    return sendCsv(res, await this.reports.statementCsv(user.userId, p, requestLang(lang), q.kind));
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
