import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(id, user.userId);
  }
}
