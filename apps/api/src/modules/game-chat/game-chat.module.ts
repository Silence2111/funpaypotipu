import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GameChatController, GameChatModerationController } from './game-chat.controller';
import { GameChatService } from './game-chat.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [GameChatController, GameChatModerationController],
  providers: [GameChatService],
  exports: [GameChatService],
})
export class GameChatModule {}
