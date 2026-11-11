import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RULE_IDS } from '@gamemarket/shared';
import type { ReportStatus, UserStatus } from '@gamemarket/db';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import {
  LISTING_FILTERS,
  ModerationService,
  USER_FILTERS,
  type ReportAction,
  type ReportTarget,
} from './moderation.service';
import { RateLimit } from '../../common/rate-limit';
import { timeCursor } from '../../common/cursor';

const reportSchema = z.object({
  targetType: z.enum(['listing', 'user', 'message', 'buy_request', 'game_chat']),
  // Цели — строки с uuid-ключом: мусорный id отсекается здесь, а не падением базы.
  targetId: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
  details: z.string().trim().max(2000).optional(),
});

const handleSchema = z.object({
  status: z.enum(['reviewing', 'resolved', 'rejected']),
  action: z.enum(['block_listing', 'remove_request', 'delete_chat_message', 'mute_chat', 'freeze_user', 'ban_user']).optional(),
  note: z.string().trim().max(500).optional(),
  // Пункт правил (часть 134): «1.2».
  rule: z.enum(RULE_IDS as [string, ...string[]]).optional(),
});

const USER_STATUSES = ['active', 'frozen', 'banned'] as const;
const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'rejected'] as const;
/** Лоты в консоли: ?status, ?seller — лоты одного продавца, ?q — название, ник или id; дальше — ?cursor. */
const listingsQuery = z.object({
  status: z.enum(LISTING_FILTERS).optional(),
  seller: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: timeCursor('Список лотов устарел — обновите страницу'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type ListingsParams = z.infer<typeof listingsQuery>;
/** Пользователи в консоли: ?status — статус или staff, ?q — ник, почта или id; дальше — ?cursor. */
const usersQuery = z.object({
  status: z.enum(USER_FILTERS).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: timeCursor('Список пользователей устарел — обновите страницу'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type UsersParams = z.infer<typeof usersQuery>;
const reportsQuery = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  /** Ник нарушителя или пожаловавшегося, название лота, id цели или жалобы. */
  q: z.string().trim().max(100).optional(),
  cursor: timeCursor('Список жалоб устарел — обновите страницу'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type ReportsParams = z.infer<typeof reportsQuery>;

@Controller()
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  // Любой авторизованный — подать жалобу
  @Post('reports')
  @RateLimit('reports', 20, 3600)
  report(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(reportSchema))
    body: { targetType: ReportTarget; targetId: string; reason: string; details?: string },
  ) {
    return this.moderation.createReport(user.userId, body.targetType, body.targetId, body.reason, body.details);
  }

  // ── Модератор ──
  @Get('moderation/reports')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  reports(@Query(new ZodValidationPipe(reportsQuery)) q: ReportsParams) {
    return this.moderation.listReports(q);
  }

  @Post('moderation/reports/:id/handle')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  handle(
    @CurrentUser() user: AuthUser,
    // Не uuid — 400, а не 500 от базы.
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(handleSchema))
    body: { status: ReportStatus; action?: ReportAction; note?: string; rule?: string },
  ) {
    return this.moderation.handleReport(id, user.userId, body);
  }

  @Get('moderation/listings')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  listings(@Query(new ZodValidationPipe(listingsQuery)) q: ListingsParams) {
    return this.moderation.listListings(q);
  }

  @Get('moderation/users')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  users(@Query(new ZodValidationPipe(usersQuery)) q: UsersParams) {
    return this.moderation.listUsers(q);
  }

  @Post('moderation/listings/:id/status')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  listingStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(['active', 'blocked']), reason: z.string().trim().max(500).optional(), rule: z.enum(RULE_IDS as [string, ...string[]]).optional() })))
    body: { status: 'active' | 'blocked'; reason?: string; rule?: string },
  ) {
    return this.moderation.setListingStatus(user.userId, id, body.status, body.reason, body.rule);
  }

  @Post('moderation/users/:id/status')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  userStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(USER_STATUSES), reason: z.string().trim().max(500).optional(), rule: z.enum(RULE_IDS as [string, ...string[]]).optional() })))
    body: { status: UserStatus; reason?: string; rule?: string },
  ) {
    return this.moderation.setUserStatus(user.userId, id, body.status, body.reason, body.rule);
  }
}
