import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.notifications.listMine(user.userId);
  }

  /** Страница «Уведомления»: ?group=orders&unread=1&before=<id>&limit=30. */
  @Get('history')
  history(
    @CurrentUser() user: AuthUser,
    @Query('group') group?: string,
    @Query('unread') unread?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.history(user.userId, {
      group: group || undefined,
      unread: unread === '1' || unread === 'true',
      before: before || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** Всё, кроме сообщений, или одну группу: ?group=orders. */
  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser, @Query('group') group?: string) {
    return this.notifications.markAllRead(user.userId, group || undefined);
  }

  /** Убрать прочитанные из списка — все, кроме сообщений, или одну группу: ?group=orders. */
  @Post('clear-read')
  clearRead(@CurrentUser() user: AuthUser, @Query('group') group?: string) {
    return this.notifications.clearRead(user.userId, group || undefined);
  }

  /** «Вернуть» убранное: ?at=<время из ответа clear-read>. */
  @Post('restore')
  restore(@CurrentUser() user: AuthUser, @Query('at') at?: string) {
    return this.notifications.restore(user.userId, at);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(id, user.userId);
  }
}
