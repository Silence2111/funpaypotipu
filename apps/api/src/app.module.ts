import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AccessModule } from './modules/access/access.module';
import { CryptoModule } from './modules/crypto/crypto.module';
import { StorageModule } from './modules/storage/storage.module';
import { AntivirusModule } from './modules/antivirus/antivirus.module';
import { MailModule } from './modules/mail/mail.module';
import { SearchModule } from './modules/search/search.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TrustModule } from './modules/trust/trust.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ListingsModule } from './modules/listings/listings.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { PromoModule } from './modules/promo/promo.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ChatModule } from './modules/chat/chat.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { AdminModule } from './modules/admin/admin.module';
import { KycModule } from './modules/kyc/kyc.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AccessModule,
    CryptoModule,
    StorageModule,
    AntivirusModule,
    MailModule,
    SearchModule,
    LedgerModule,
    NotificationsModule,
    TrustModule,
    HealthModule,
    AuthModule,
    CatalogModule,
    ListingsModule,
    InventoryModule,
    FavoritesModule,
    PromoModule,
    OrdersModule,
    PaymentsModule,
    WalletModule,
    PayoutsModule,
    ReviewsModule,
    ChatModule,
    DisputesModule,
    ModerationModule,
    AdminModule,
    KycModule,
  ],
})
export class AppModule {}
