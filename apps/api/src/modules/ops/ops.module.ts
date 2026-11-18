import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { YooKassaProvider } from '../payments/yookassa.provider';
import { YooKassaPayouts } from '../payouts/yookassa-payouts';
import { YooKassaDealGateway } from '../safe-deal/deal.gateway';
import { OpsController } from './ops.controller';
import { OpsAlertService } from './ops-alert.service';
import { ErrorMonitorService } from './error-monitor.service';
import { OpsWatchService } from './ops-watch.service';
import { ReconciliationService } from './reconciliation.service';
import { FunnelService } from './funnel.service';

/**
 * Сверка с ЮKassa, сбор ошибок и тревоги, воронка запуска (части 129–131).
 * Шлюзы ЮKassa здесь свои экземпляры: они без состояния и читают ключи из
 * окружения, как в модулях оплат и выплат.
 */
@Module({
  imports: [AuthModule],
  controllers: [OpsController],
  providers: [
    OpsAlertService,
    ErrorMonitorService,
    OpsWatchService,
    ReconciliationService,
    FunnelService,
    YooKassaProvider,
    YooKassaPayouts,
    YooKassaDealGateway,
  ],
})
export class OpsModule {}
