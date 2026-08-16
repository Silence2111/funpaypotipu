import { describe, expect, it } from 'vitest';
import {
  WITHDRAWAL_METHODS,
  computeWithdrawalFee,
  getWithdrawalMethod,
} from '@gamemarket/shared';

/**
 * Правила вывода денег.
 *
 * Здесь заканчивается путь денег продавца, и цена ошибки прямая: занижена
 * комиссия — работаем в минус на каждом выводе; завышена — продавец уходит
 * к конкуренту, у которого ставка честнее. Суммы в минорных единицах
 * (копейках), потому что дробями деньги не считают.
 */

const sbp = getWithdrawalMethod('sbp')!;
const usdt = getWithdrawalMethod('usdt')!;

describe('справочник методов', () => {
  it('ставки ниже конкурентов', () => {
    // Прямой аргумент для продавца: FunPay 3%, Playerok 6%
    for (const m of WITHDRAWAL_METHODS) expect(m.feePct).toBeLessThan(0.03);
  });

  it('ключи уникальны', () => {
    const keys = WITHDRAWAL_METHODS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('минимум всегда меньше максимума', () => {
    for (const m of WITHDRAWAL_METHODS) expect(m.minAmount).toBeLessThan(m.maxAmount);
  });

  it('несуществующий метод не находится', () => {
    expect(getWithdrawalMethod('наличными')).toBeUndefined();
  });
});

describe('комиссия', () => {
  it('процент считается от суммы', () => {
    // 100 000 копеек = 1000 ₽, 2,5% = 2500 копеек
    expect(computeWithdrawalFee(100_000n, sbp)).toBe(2500n);
  });

  it('на мелкой сумме работает минимальная комиссия', () => {
    // 2,5% от 300 ₽ = 7,5 ₽, но минимум 25 ₽ — иначе перевод дороже комиссии
    expect(computeWithdrawalFee(30_000n, sbp)).toBe(sbp.minFee);
  });

  it('на крупной сумме минимум не мешает', () => {
    expect(computeWithdrawalFee(1_000_000n, sbp)).toBe(25_000n);
  });

  it('у метода без минимума комиссия чисто процентная', () => {
    expect(computeWithdrawalFee(100_000n, usdt)).toBe(1500n);
  });

  it('комиссия никогда не больше самой суммы', () => {
    // Иначе продавец получил бы отрицательную выплату
    for (const m of WITHDRAWAL_METHODS) {
      expect(computeWithdrawalFee(m.minAmount, m)).toBeLessThan(m.minAmount);
    }
  });

  it('нулевая сумма даёт минимальную комиссию, а не отрицательную', () => {
    expect(computeWithdrawalFee(0n, sbp)).toBe(sbp.minFee);
    expect(computeWithdrawalFee(0n, usdt)).toBe(0n);
  });
});

describe('к выплате на руки', () => {
  const net = (gross: bigint, m = sbp) => gross - computeWithdrawalFee(gross, m);

  it('на руки приходит сумма за вычетом комиссии', () => {
    expect(net(100_000n)).toBe(97_500n);
  });

  it('минимальный вывод всё равно оставляет деньги продавцу', () => {
    for (const m of WITHDRAWAL_METHODS) {
      expect(net(m.minAmount, m)).toBeGreaterThan(0n);
    }
  });

  it('USDT выгоднее рублёвых способов на крупных суммах', () => {
    // Это и есть аргумент, ради которого метод добавлен
    const gross = 5_000_000n;
    expect(net(gross, usdt)).toBeGreaterThan(net(gross, sbp));
  });
});
