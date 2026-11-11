import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { GAME_CHAT_MAX_LEN, GAME_CHAT_MUTE_HOURS } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { GameChatService } from './game-chat.service';

const postBody = z.object({
  body: z
    .string()
    .trim()
    .min(2, 'Сообщение — от 2 знаков')
    .max(GAME_CHAT_MAX_LEN, `Сообщение — до ${GAME_CHAT_MAX_LEN} знаков`),
});
const listQuery = z.object({ before: z.string().uuid().optional() });

/** Общий чат игры (часть 133): читать — всем, писать — вошедшим. */
@Controller('game-chat')
export class GameChatController {
  constructor(private readonly chat: GameChatService) {}

  @Get(':slug')
  list(@Param('slug') slug: string, @Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.chat.list(slug, q.before);
  }

  @Post(':slug')
  @UseGuards(JwtAuthGuard)
  @RateLimit('game-chat', 30, 600)
  post(@CurrentUser() u: AuthUser, @Param('slug') slug: string, @Body(new ZodValidationPipe(postBody)) body: z.infer<typeof postBody>) {
    return this.chat.post(slug, u.userId, body.body);
  }

  @Delete('messages/:id')
  @UseGuards(JwtAuthGuard)
  removeOwn(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.removeOwn(u.userId, id);
  }
}

const modQuery = z.object({
  game: z.string().max(80).optional(),
  q: z.string().max(100).optional(),
  reported: z.enum(['1']).optional(),
  deleted: z.enum(['1']).optional(),
  before: z.string().uuid().optional(),
});
const reasonBody = z.object({ reason: z.string().trim().min(3, 'Причина — от 3 знаков').max(300) });
const muteBody = z.object({
  hours: z
    .number()
    .int()
    .refine((h) => h === 0 || (GAME_CHAT_MUTE_HOURS as readonly number[]).includes(h), 'Срок запрета — сутки, неделя или месяц'),
  reason: z.string().trim().max(300).default(''),
});

/** Чаты игр в консоли: лента всех игр, жалобы, удаление и запрет писать. */
@Controller('moderation/game-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator')
export class GameChatModerationController {
  constructor(private readonly chat: GameChatService) {}

  @Get()
  list(@Query(new ZodValidationPipe(modQuery)) q: z.infer<typeof modQuery>) {
    return this.chat.moderationList({ game: q.game, q: q.q, reported: q.reported === '1', deleted: q.deleted === '1', before: q.before });
  }

  @Post(':id/delete')
  @HttpCode(200)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonBody)) body: z.infer<typeof reasonBody>) {
    return this.chat.remove(u.userId, id, body.reason);
  }

  @Post('users/:id/mute')
  @HttpCode(200)
  mute(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(muteBody)) body: z.infer<typeof muteBody>) {
    return this.chat.mute(u.userId, id, body.hours, body.reason || 'Нарушение правил чата');
  }
}
