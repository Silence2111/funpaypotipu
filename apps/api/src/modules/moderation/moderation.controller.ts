import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { ListingStatus, ReportStatus, UserStatus } from '@gamemarket/db';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { ModerationService, type ReportAction, type ReportTarget } from './moderation.service';

const reportSchema = z.object({
  targetType: z.enum(['listing', 'user', 'message']),
  // Цели — строки с uuid-ключом: мусорный id отсекается здесь, а не падением базы.
  targetId: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
  details: z.string().trim().max(2000).optional(),
});

const handleSchema = z.object({
  status: z.enum(['reviewing', 'resolved', 'rejected']),
  action: z.enum(['block_listing', 'freeze_user', 'ban_user']).optional(),
  note: z.string().trim().max(500).optional(),
});

const LISTING_STATUSES = ['draft', 'active', 'paused', 'sold_out', 'blocked', 'archived'] as const;
const USER_STATUSES = ['active', 'frozen', 'banned'] as const;
const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'rejected'] as const;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined =>
  allowed.includes(v as T) ? (v as T) : undefined;

@Controller()
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  // Любой авторизованный — подать жалобу
  @Post('reports')
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
  reports(@Query('status') status?: string) {
    return this.moderation.listReports(pick<ReportStatus>(status, REPORT_STATUSES));
  }

  @Post('moderation/reports/:id/handle')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  handle(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(handleSchema))
    body: { status: ReportStatus; action?: ReportAction; note?: string },
  ) {
    return this.moderation.handleReport(id, user.userId, body);
  }

  @Get('moderation/listings')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  listings(@Query('q') q?: string, @Query('status') status?: string) {
    return this.moderation.searchListings(q, pick<ListingStatus>(status, LISTING_STATUSES));
  }

  @Get('moderation/users')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  users(@Query('q') q?: string, @Query('status') status?: string) {
    return this.moderation.searchUsers(q, pick<UserStatus>(status, USER_STATUSES));
  }

  @Post('moderation/listings/:id/status')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  listingStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(['active', 'blocked']), reason: z.string().trim().max(500).optional() })))
    body: { status: 'active' | 'blocked'; reason?: string },
  ) {
    return this.moderation.setListingStatus(user.userId, id, body.status, body.reason);
  }

  @Post('moderation/users/:id/status')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  userStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(USER_STATUSES), reason: z.string().trim().max(500).optional() })))
    body: { status: UserStatus; reason?: string },
  ) {
    return this.moderation.setUserStatus(user.userId, id, body.status, body.reason);
  }
}
