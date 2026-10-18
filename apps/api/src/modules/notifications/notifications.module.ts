import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { PushService } from './push.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, TelegramController],
  providers: [NotificationsService, TelegramService, PushService],
  exports: [NotificationsService, TelegramService, PushService],
})
export class NotificationsModule {}
