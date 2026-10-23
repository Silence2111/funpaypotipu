import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { STATS_PERIODS, type StatsPeriod } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { TokenService } from '../auth/token.service';
import { LotStatsService } from './lot-stats.service';

const querySchema = z.object({
  days: z.coerce
    .number()
    .refine((d): d is StatsPeriod => (STATS_PERIODS as readonly number[]).includes(d), {
      message: 'Период — 7, 30 или 90 дней',
    })
    .default(30),
  listingId: z.string().uuid().optional(),
});

@Controller('lot-stats')
export class LotStatsController {
  constructor(
    private readonly stats: LotStatsService,
    private readonly tokens: TokenService,
  ) {}

  /** «Статистика лотов» продавца за 7, 30 или 90 дней. */
  @Get()
  @UseGuards(JwtAuthGuard)
  mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(querySchema)) q: { days: StatsPeriod; listingId?: string },
  ) {
    return this.stats.sellerStats(user.userId, q.days, q.listingId);
  }

  /**
   * Просмотр страницы лота — её шлёт браузер раз в сутки. Вход не нужен;
   * если он есть, просмотр самого продавца не засчитывается. Сеанс тут не
   * проверяем: токен нужен только чтобы узнать продавца.
   */
  @Post(':id/view')
  @HttpCode(200)
  @RateLimit('lot-view', 120, 60)
  view(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const header = req.headers.authorization;
    let viewer: string | null = null;
    if (header?.startsWith('Bearer ')) {
      try {
        viewer = this.tokens.verifyAccess(header.slice(7)).sub;
      } catch {
        viewer = null;
      }
    }
    return this.stats.recordView(id, viewer);
  }
}
