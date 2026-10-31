import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { SUPPORT_CATEGORIES, SupportService, TICKET_STATUSES, type SupportCategory } from './support.service';
import { RateLimit } from '../../common/rate-limit';

const createSchema = z.object({
  subject: z.string().trim().min(3, 'Тема — от 3 символов').max(120),
  category: z.enum(SUPPORT_CATEGORIES),
  orderId: z.string().uuid().optional(),
  body: z.string().trim().min(10, 'Опишите вопрос подробнее — от 10 символов').max(4000),
});
const replySchema = z.object({ body: z.string().trim().min(1, 'Пустое сообщение').max(4000) });
const STALE = 'Список обращений устарел — обновите страницу';
const queueSchema = z.object({
  status: z.enum(TICKET_STATUSES).default('open'),
  q: z.string().trim().max(100).optional(),
  // `next` прошлой страницы: «время_id» последнего показанного обращения.
  cursor: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      const m = /^(.+)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(v);
      const at = m ? new Date(m[1]!) : null;
      if (!m || !at || Number.isNaN(at.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: STALE });
        return z.NEVER;
      }
      return { at, id: m[2]! };
    }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type QueueParams = z.infer<typeof queueSchema>;

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('tickets')
  @RateLimit('support', 10, 3600)
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
  queue(@Query(new ZodValidationPipe(queueSchema)) q: QueueParams) {
    return this.support.queue(q);
  }

  @Get('tickets/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.get(id, user.userId);
  }

  @Post('tickets/:id/messages')
  @RateLimit('support-msg', 60, 600)
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(replySchema)) body: { body: string }) {
    return this.support.reply(id, user.userId, body.body);
  }

  @Post('tickets/:id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.close(id, user.userId);
  }
}
