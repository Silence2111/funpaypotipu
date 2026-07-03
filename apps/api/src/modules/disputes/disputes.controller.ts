import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { DisputesService } from './disputes.service';

const openSchema = z.object({ orderId: z.string().uuid(), reason: z.string().min(3).max(2000) });
const messageSchema = z.object({ body: z.string().min(1).max(4000), internal: z.boolean().optional() });
const resolveSchema = z.object({
  outcome: z.enum(['seller', 'buyer']),
  note: z.string().max(2000).optional(),
});

@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  open(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(openSchema)) body: { orderId: string; reason: string },
  ) {
    return this.disputes.open(body.orderId, user.userId, body.reason);
  }

  @Get('queue')
  @UseGuards(RolesGuard)
  @Roles('agent')
  queue() {
    return this.disputes.queue();
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.getForUser(id, user.userId);
  }

  @Post(':id/messages')
  message(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(messageSchema)) body: { body: string; internal?: boolean },
  ) {
    return this.disputes.addMessage(id, user.userId, body.body, body.internal ?? false);
  }

  @Post(':id/take')
  @UseGuards(RolesGuard)
  @Roles('agent')
  take(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.take(id, user.userId);
  }

  @Post(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('agent')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveSchema)) body: { outcome: 'seller' | 'buyer'; note?: string },
  ) {
    return this.disputes.resolve(id, user.userId, body.outcome, body.note);
  }
}
