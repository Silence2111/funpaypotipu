import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ANTIFRAUD_LIMITS } from '@gamemarket/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { TrustService } from './trust.service';
import { AntifraudService } from './antifraud.service';

@Controller('trust')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'agent')
export class TrustController {
  constructor(
    private readonly trust: TrustService,
    private readonly antifraud: AntifraudService,
  ) {}

  /** Риск-балл, последние сигналы и связанные аккаунты (часть 128) — для консоли. */
  @Get('users/:id')
  async user(@Param('id', ParseUUIDPipe) id: string) {
    const [score, signals, links] = await Promise.all([
      this.trust.riskScore(id),
      this.trust.listSignals(id, 20),
      this.antifraud.links(id),
    ]);
    return { ...score, recent: signals, links };
  }
}

const settingsBody = z.object({
  enabled: z.boolean(),
  newbiePayDay: z
    .number()
    .int()
    .min(ANTIFRAUD_LIMITS.newbiePayDay.min, 'Оплаты новичка за сутки — от 1 000 до 1 000 000 ₽')
    .max(ANTIFRAUD_LIMITS.newbiePayDay.max, 'Оплаты новичка за сутки — от 1 000 до 1 000 000 ₽'),
  paymentsPerHour: z
    .number()
    .int()
    .min(ANTIFRAUD_LIMITS.paymentsPerHour.min, 'Оплат в час — от 3 до 200')
    .max(ANTIFRAUD_LIMITS.paymentsPerHour.max, 'Оплат в час — от 3 до 200'),
  newbiePaymentsPerHour: z
    .number()
    .int()
    .min(ANTIFRAUD_LIMITS.newbiePaymentsPerHour.min, 'Оплат в час у новичка — от 1 до 100')
    .max(ANTIFRAUD_LIMITS.newbiePaymentsPerHour.max, 'Оплат в час у новичка — от 1 до 100'),
  newbieLotsPerDay: z
    .number()
    .int()
    .min(ANTIFRAUD_LIMITS.newbieLotsPerDay.min, 'Лотов в сутки у новичка — от 1 до 1000')
    .max(ANTIFRAUD_LIMITS.newbieLotsPerDay.max, 'Лотов в сутки у новичка — от 1 до 1000'),
  blockLinkedDeals: z.boolean(),
});

/** Лимиты антифрода в консоли — только администратор, с записью в журнал. */
@Controller('admin/antifraud')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AntifraudController {
  constructor(private readonly antifraud: AntifraudService) {}

  @Get()
  get() {
    return this.antifraud.view();
  }

  @Put()
  save(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(settingsBody)) body: z.infer<typeof settingsBody>) {
    return this.antifraud.save(body, u.userId);
  }

  @Delete()
  reset(@CurrentUser() u: AuthUser) {
    return this.antifraud.reset(u.userId);
  }
}
