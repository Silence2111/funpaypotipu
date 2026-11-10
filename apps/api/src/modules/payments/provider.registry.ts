import { Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentProvider } from './payment.provider';
import { MockPaymentProvider } from './mock.provider';
import { YooKassaProvider } from './yookassa.provider';

/**
 * Реестр платёжных провайдеров. Добавление реального провайдера = новый класс,
 * зарегистрированный здесь; ядро (orders/ledger) не меняется.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(mock: MockPaymentProvider, yookassa?: YooKassaProvider) {
    this.register(mock);
    // ЮKassa — когда заданы ключи магазина; выбирается PAYMENT_PROVIDER=yookassa.
    if (yookassa?.enabled) this.register(yookassa);
  }

  register(provider: PaymentProvider) {
    this.providers.set(provider.key, provider);
  }

  /** Провайдер, через который платят сейчас. */
  get current(): PaymentProvider {
    return this.get(this.defaultKey);
  }

  get(key: string): PaymentProvider {
    const p = this.providers.get(key);
    if (!p) throw new NotFoundException(`Платёжный провайдер "${key}" не найден`);
    return p;
  }

  get defaultKey(): string {
    const key = process.env.PAYMENT_PROVIDER;
    if (key) return key;

    // Заглушка подтверждает оплату, не приняв денег: заказ уходит в работу,
    // ключ выдаётся, продавец ждёт перевода, которого не было. Снаружи это
    // выглядит как работающий магазин — и разбираться придётся не с кодом,
    // а с людьми по обе стороны сделки.
    //
    // Вне боя заглушка удобна и остаётся по умолчанию. В бою — только если
    // названа явно: осознанный выбор не ошибка, ошибка — когда он получается
    // сам собой из пустой переменной.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'PAYMENT_PROVIDER не задан. Заглушка подтверждает оплату, не приняв денег.\n' +
          'Укажите настоящего провайдера либо PAYMENT_PROVIDER=mock, если это осознанно.',
      );
    }
    return 'mock';
  }
}
