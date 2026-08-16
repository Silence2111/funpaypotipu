import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PaymentProviderRegistry } from '../src/modules/payments/provider.registry';
import { MockPaymentProvider } from '../src/modules/payments/mock.provider';

/**
 * Выбор платёжного провайдера.
 *
 * Заглушка подтверждает оплату, не приняв денег: заказ уходит в работу,
 * ключ выдаётся, продавец ждёт перевода, которого не было. Снаружи это
 * выглядит как работающий магазин, и разбираться приходится не с кодом,
 * а с людьми по обе стороны сделки.
 *
 * Раньше она включалась сама из пустой переменной окружения.
 */

const ENV = { ...process.env };

beforeEach(() => {
  delete process.env.PAYMENT_PROVIDER;
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  process.env = { ...ENV };
});

describe('провайдер по умолчанию', () => {
  it('вне боя без настроек — заглушка', () => {
    const r = new PaymentProviderRegistry(new MockPaymentProvider());
    expect(r.defaultKey).toBe('mock');
  });

  it('в бою без настроек — падаем, а не принимаем деньги в никуда', () => {
    process.env.NODE_ENV = 'production';
    const r = new PaymentProviderRegistry(new MockPaymentProvider());
    expect(() => r.defaultKey).toThrow(/не приняв денег/);
  });

  it('в бою заглушка разрешена, если названа явно', () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_PROVIDER = 'mock';
    const r = new PaymentProviderRegistry(new MockPaymentProvider());
    expect(r.defaultKey).toBe('mock');
  });

  it('заданный провайдер возвращается как есть', () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_PROVIDER = 'yookassa';
    const r = new PaymentProviderRegistry(new MockPaymentProvider());
    expect(r.defaultKey).toBe('yookassa');
  });
});
