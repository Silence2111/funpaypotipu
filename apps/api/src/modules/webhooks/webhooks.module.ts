import { Global, Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

/** Вебхуки продавцов (часть 127): глобально — заказы ставят события в очередь. */
@Global()
@Module({
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
