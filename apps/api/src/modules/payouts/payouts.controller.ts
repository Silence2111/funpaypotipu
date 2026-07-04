import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { PayoutsService } from './payouts.service';

const requestSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v))
    .refine((v) => /^\d+$/.test(v), 'ожидается целое число минорных единиц'),
  method: z.enum(['card', 'sbp', 'crypto']),
  destination: z.string().min(4).max(200),
});
const rejectSchema = z.object({ reason: z.string().max(500).optional() });

@Controller('payouts')
@UseGuards(JwtAuthGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(requestSchema))
    body: { amount: string; method: 'card' | 'sbp' | 'crypto'; destination: string },
  ) {
    return this.payouts.request(user.userId, BigInt(body.amount), body.method, body.destination);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.payouts.listMine(user.userId);
  }

  // ── Финансовый оператор ──
  @Get()
  @UseGuards(RolesGuard)
  @Roles('finance')
  list(@Query('status') status?: 'requested' | 'approved' | 'processing' | 'paid' | 'rejected') {
    return this.payouts.list(status);
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('finance')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payouts.approve(id, user.userId);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('finance')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: { reason?: string },
  ) {
    return this.payouts.reject(id, user.userId, body.reason);
  }
}
