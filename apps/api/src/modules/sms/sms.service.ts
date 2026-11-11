import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { maskPhone } from '@gamemarket/shared';

/**
 * Отправщик SMS (часть 121). Провайдер — переменная `SMS_PROVIDER`; пока
 * подключена только заглушка `mock`: она пишет в журнал номер под маской и
 * ничего не отправляет. Настоящий провайдер (SMS.ru, SMSC, МТС Exolve)
 * добавляется веткой в `send` — когда владелец выберет его и даст ключи.
 *
 * На проде с заглушкой вход по телефону выключен: сайт не показывает его,
 * API отвечает 503 — притворяться, что код ушёл, нельзя.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  readonly provider = (process.env.SMS_PROVIDER ?? 'mock').trim() || 'mock';
  /** Последнее SMS на номер — только для e2e с `SMS_TEST_INBOX=1` и заглушкой вне прода. */
  private readonly inbox = new Map<string, string>();

  get enabled(): boolean {
    return this.provider !== 'mock' || process.env.NODE_ENV !== 'production';
  }

  get testInbox(): boolean {
    return this.provider === 'mock' && process.env.SMS_TEST_INBOX === '1' && process.env.NODE_ENV !== 'production';
  }

  async send(phone: string, text: string): Promise<void> {
    if (!this.enabled) throw new ServiceUnavailableException('Вход по телефону пока не работает');
    if (this.provider === 'mock') {
      this.logger.log(`SMS на ${maskPhone(phone)} (заглушка, не отправлено)`);
      if (this.testInbox) this.inbox.set(phone, text);
      return;
    }
    throw new ServiceUnavailableException('Вход по телефону пока не работает');
  }

  lastText(phone: string): string | null {
    return this.testInbox ? (this.inbox.get(phone) ?? null) : null;
  }
}
