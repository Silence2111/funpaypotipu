import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ListingsModule } from './modules/listings/listings.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ChatModule } from './modules/chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    LedgerModule,
    NotificationsModule,
    HealthModule,
    AuthModule,
    CatalogModule,
    ListingsModule,
    OrdersModule,
    PaymentsModule,
    WalletModule,
    ReviewsModule,
    ChatModule,
  ],
})
export class AppModule {}
