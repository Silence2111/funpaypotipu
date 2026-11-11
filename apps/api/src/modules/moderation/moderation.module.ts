import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameChatModule } from '../game-chat/game-chat.module';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

@Module({
  // Жалобы на сообщения чатов игр решаются удалением и запретом писать (часть 133).
  imports: [AuthModule, GameChatModule],
  controllers: [ModerationController],
  providers: [ModerationService],
})
export class ModerationModule {}
