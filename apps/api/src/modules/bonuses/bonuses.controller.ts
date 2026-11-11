import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BonusesService } from './bonuses.service';

/** Бонусы в кошельке (часть 146): баланс и последние начисления и списания. */
@Controller('account/bonuses')
@UseGuards(JwtAuthGuard)
export class BonusesController {
  constructor(private readonly bonuses: BonusesService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.bonuses.summary(user.userId);
  }
}
