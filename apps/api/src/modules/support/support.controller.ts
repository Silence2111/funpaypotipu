import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { SUPPORT_CATEGORIES, SupportService, TICKET_STATUSES, type SupportCategory } from './support.service';
import { RateLimit } from '../../common/rate-limit';
import { timeCursor } from '../../common/cursor';

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
  cursor: timeCursor(STALE),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type QueueParams = z.infer<typeof queueSchema>;

const rateSchema = z.object({
  rating: z.number().int().min(1, 'Оценка — от 1 до 5').max(5, 'Оценка — от 1 до 5'),
  comment: z.string().trim().max(1000).optional(),
});
const templateSchema = z.object({
  title: z.string().trim().min(2, 'Название — от 2 знаков').max(80),
  body: z.string().trim().min(5, 'Текст — от 5 знаков').max(4000),
});

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

  /** Оценка ответа поддержки (часть 138). */
  @Post('tickets/:id/rate')
  @HttpCode(200)
  rate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(rateSchema)) body: { rating: number; comment?: string }) {
    return this.support.rate(id, user.userId, body.rating, body.comment);
  }

  /** «Обычно отвечаем за …» — для страницы поддержки. */
  @Get('stats')
  stats() {
    return this.support.stats(false);
  }

  /** Время ответа, оценки, ждущие и эскалированные — для консоли. */
  @Get('stats/staff')
  @UseGuards(RolesGuard)
  @Roles('agent', 'moderator')
  staffStats() {
    return this.support.stats(true);
  }

  @Get('templates')
  @UseGuards(RolesGuard)
  @Roles('agent', 'moderator')
  templates() {
    return this.support.templates();
  }

  @Post('templates')
  @UseGuards(RolesGuard)
  @Roles('agent', 'moderator')
  addTemplate(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(templateSchema)) body: { title: string; body: string }) {
    return this.support.saveTemplate(user.userId, body);
  }

  @Put('templates/:id')
  @UseGuards(RolesGuard)
  @Roles('agent', 'moderator')
  editTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(templateSchema)) body: { title: string; body: string }) {
    return this.support.saveTemplate(user.userId, body, id);
  }

  @Delete('templates/:id')
  @UseGuards(RolesGuard)
  @Roles('agent', 'moderator')
  removeTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.removeTemplate(id);
  }

  @Post('tickets/:id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.close(id, user.userId);
  }
}
