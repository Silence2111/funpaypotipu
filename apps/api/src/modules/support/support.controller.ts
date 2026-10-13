import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { SUPPORT_CATEGORIES, SupportService, type SupportCategory, type TicketStatus } from './support.service';

const createSchema = z.object({
  subject: z.string().trim().min(3, 'Тема — от 3 символов').max(120),
  category: z.enum(SUPPORT_CATEGORIES),
  orderId: z.string().uuid().optional(),
  body: z.string().trim().min(10, 'Опишите вопрос подробнее — от 10 символов').max(4000),
});
const replySchema = z.object({ body: z.string().trim().min(1, 'Пустое сообщение').max(4000) });

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('tickets')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: { subject: string; category: SupportCategory; orderId?: string; body: string },
  ) {
    return this.support.create(user.userId, body);
  }

  @Get('tickets')
  mine(@CurrentUser() user: AuthUser) {
    return this.support.listMine(user.userId);
  }

  @Get('queue')
  @UseGuards(RolesGuard)
  @Roles('agent', 'moderator')
  queue(@Query('status') status?: string) {
    const s = (['open', 'answered', 'closed'] as const).find((v) => v === status);
    return this.support.queue(s as TicketStatus | undefined);
  }

  @Get('tickets/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.get(id, user.userId);
  }

  @Post('tickets/:id/messages')
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(replySchema)) body: { body: string }) {
    return this.support.reply(id, user.userId, body.body);
  }

  @Post('tickets/:id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.close(id, user.userId);
  }
}
