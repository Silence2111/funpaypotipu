import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ChatModule } from '../chat/chat.module';
import { TelegramActionsService } from './telegram-actions.service';

/** Кнопки и ответы в Telegram: боту — заказы и чат, без циклов между модулями. */
@Module({
  imports: [OrdersModule, ChatModule],
  providers: [TelegramActionsService],
})
export class TelegramActionsModule {}
