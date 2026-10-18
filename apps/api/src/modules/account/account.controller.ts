import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BlocksService } from '../access/blocks.service';
import { AccountService } from './account.service';
import { NOTIFY_GROUPS } from '@gamemarket/shared';

// Группы — ровно те, что в shared/notify.ts: лишний ключ не попадёт в базу.
const groupFlags = z
  .object(Object.fromEntries(NOTIFY_GROUPS.map((g) => [g.key, z.boolean().optional()])) as Record<string, z.ZodOptional<z.ZodBoolean>>)
  .strict();
const notifySchema = z.object({ email: groupFlags.optional(), telegram: groupFlags.optional() });

const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Имя — от 2 символов').max(40, 'Имя — до 40 символов').optional(),
  bio: z.string().trim().max(500, 'О себе — до 500 символов').nullable().optional(),
});

@Controller('account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly blocks: BlocksService,
  ) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.account.profile(user.userId);
  }

  /** Счётчики шапки: сообщения, уведомления, баланс, продажи и покупки, ждущие действия. */
  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.account.summary(user.userId);
  }

  @Patch('profile')
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(profileSchema)) body: { displayName?: string; bio?: string | null },
  ) {
    return this.account.updateProfile(user.userId, body);
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  avatar(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number }) {
    return this.account.setAvatar(user.userId, file);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.account.removeAvatar(user.userId);
  }

  // ── Уведомления ──
  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser) {
    return this.account.notifications(user.userId);
  }

  @Patch('notifications')
  updateNotifications(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(notifySchema)) body: { email?: Record<string, boolean>; telegram?: Record<string, boolean> },
  ) {
    return this.account.updateNotifications(user.userId, body);
  }

  @Post('telegram/link')
  telegramLink(@CurrentUser() user: AuthUser) {
    return this.account.telegramLink(user.userId);
  }

  @Delete('telegram')
  telegramUnlink(@CurrentUser() user: AuthUser) {
    return this.account.telegramUnlink(user.userId);
  }

  // ── Чёрный список ──
  @Get('blocks')
  blocksList(@CurrentUser() user: AuthUser) {
    return this.blocks.list(user.userId);
  }

  @Post('blocks')
  block(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(z.object({ userId: z.string().uuid() }))) body: { userId: string }) {
    return this.blocks.add(user.userId, body.userId);
  }

  @Delete('blocks/:userId')
  unblock(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.blocks.remove(user.userId, userId);
  }
}
