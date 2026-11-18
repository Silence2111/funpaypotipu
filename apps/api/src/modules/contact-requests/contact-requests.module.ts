import { Module } from '@nestjs/common';
import { ContactRequestsController } from './contact-requests.controller';
import { OpsAlertService } from '../ops/ops-alert.service';

/** Форма обращения из юрдокументов (/obrashchenie/): база и тревога сотрудникам. */
@Module({ controllers: [ContactRequestsController], providers: [OpsAlertService] })
export class ContactRequestsModule {}
