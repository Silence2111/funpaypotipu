import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, TelegramController],
  providers: [NotificationsService, TelegramService],
  exports: [NotificationsService, TelegramService],
})
export class NotificationsModule {}
