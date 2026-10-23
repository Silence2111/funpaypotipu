import { Controller, Get } from '@nestjs/common';
import { RankingService } from './ranking.service';

/**
 * Публичный результат замера выдачи — на витрине, а не в отчёте. Пока
 * заказов нет, отвечает «замер невозможен» с порогами: цифра, которую нельзя
 * проверить, хуже её отсутствия — её потом цитируют.
 */
@Controller('ranking')
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Get('benchmark')
  benchmark() {
    return this.ranking.benchmark();
  }
}
