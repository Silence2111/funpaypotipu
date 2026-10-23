import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ChatService } from './chat.service';
import { RateLimit } from '../../common/rate-limit';

const sendSchema = z.object({ body: z.string().min(1).max(4000) });
const startSchema = z.object({ body: z.string().min(1).max(4000).optional() }).default({});
const historySchema = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const uploadSchema = z.object({ mime: z.string().min(3).max(100) });
const attachmentSchema = z.object({
  key: z.string().min(3).max(300),
  mime: z.string().min(3).max(100),
  size: z.number().int().nonnegative(),
});

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.chat.listConversations(user.userId);
  }

  /** Начатый диалог с продавцом лота и непрочитанные в нём; { id: null } — ничего не создаёт. */
  @Get('for-listing/:listingId')
  findWithSeller(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    return this.chat.findWithSeller(user.userId, listingId);
  }

  /** Начать/открыть предпродажный диалог с продавцом лота; с { body } — и написать о лоте. */
  @Post('for-listing/:listingId')
  @RateLimit('chat-send', 60, 60)
  startWithSeller(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Body(new ZodValidationPipe(startSchema)) body: { body?: string },
  ) {
    return this.chat.startWithSeller(user.userId, listingId, body.body);
  }

  @Get(':id')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.getConversation(id, user.userId);
  }

  /** Последние сообщения; ?before=<время> — те, что раньше (история при прокрутке вверх). */
  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(historySchema)) q: { before?: Date; limit: number },
  ) {
    return this.chat.getMessages(id, user.userId, q);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.markRead(id, user.userId);
  }

  @Post(':id/messages')
  @RateLimit('chat-send', 60, 60)
  send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendSchema)) body: { body: string },
  ) {
    return this.chat.sendMessage(id, user.userId, body.body);
  }

  /** Получить presigned PUT-URL для загрузки вложения. */
  @Post(':id/uploads')
  @RateLimit('uploads', 30, 600)
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(uploadSchema)) body: { mime: string },
  ) {
    return this.chat.requestUpload(id, user.userId, body.mime);
  }

  /** Зарегистрировать вложение как сообщение (после загрузки по presigned-URL). */
  @Post(':id/attachments')
  attach(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(attachmentSchema)) body: { key: string; mime: string; size: number },
  ) {
    return this.chat.sendAttachment(id, user.userId, body.key, body.mime, body.size);
  }
}
