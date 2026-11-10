import { describe, it, expect } from 'vitest';
import {
  TOPUP_LIMITS,
  markupLabel,
  pickTopupOffer,
  topupAccountError,
  topupAmountError,
  topupQuote,
  topupRange,
  topupTermsError,
  type TopupTerms,
} from './topup';

/**
 * Пополнение на сумму покупателя: цена считается из номинала и наценки.
 * Здесь проверяется то, что стоит денег: копейка в цене, граница суммы,
 * выбор самого дешёвого предложения.
 */

const STEAM: TopupTerms = { markupBps: 800, min: 10_000n, max: 1_500_000n };

describe('цена пополнения', () => {
  it('1 000 ₽ при наценке 8% стоят 1 080 ₽', () => {
    expect(topupQuote(100_000n, 800)).toEqual({ nominal: 100_000n, markup: 8_000n, price: 108_000n });
  });

  it('без наценки цена равна номиналу', () => {
    expect(topupQuote(100_000n, 0).price).toBe(100_000n);
  });

  it('7% от 1 000 ₽ — ровно 70 ₽, без лишней копейки от float', () => {
    // 0.07 × 100 000 во float = 7 000,000000000001, ceil дал бы 7 001
    expect(topupQuote(100_000n, 700).markup).toBe(7_000n);
  });

  it('дробная копейка наценки округляется вверх', () => {
    // 7,5% от 123 ₽ = 9,225 ₽ → 9,23 ₽
    expect(topupQuote(12_300n, 750).markup).toBe(923n);
  });

  it('цена растёт вместе с суммой и не меньше номинала', () => {
    let prev = 0n;
    for (let rub = 100n; rub <= 15_000n; rub += 997n) {
      const q = topupQuote(rub * 100n, 650);
      expect(q.price).toBeGreaterThanOrEqual(q.nominal);
      expect(q.price).toBeGreaterThan(prev);
      prev = q.price;
    }
  });
});

describe('сумма пополнения', () => {
  it('сумма в границах проходит', () => {
    expect(topupAmountError(100_000n, STEAM)).toBeNull();
    expect(topupAmountError(STEAM.min, STEAM)).toBeNull();
    expect(topupAmountError(STEAM.max, STEAM)).toBeNull();
  });

  it('ниже минимума и выше максимума — отказ с границей в тексте', () => {
    expect(topupAmountError(9_900n, STEAM)).toMatch(/Минимум.*100/);
    expect(topupAmountError(1_500_100n, STEAM)).toMatch(/Максимум.*15/);
  });

  it('копейки и ноль не принимаются', () => {
    expect(topupAmountError(100_050n, STEAM)).toMatch(/целое число рублей/);
    expect(topupAmountError(0n, STEAM)).toMatch(/Укажите сумму/);
    expect(topupAmountError(-100n, STEAM)).toMatch(/Укажите сумму/);
  });
});

describe('условия продавца', () => {
  it('обычные условия годятся', () => {
    expect(topupTermsError(STEAM)).toBeNull();
  });

  it('наценка выше потолка и отрицательная — отказ', () => {
    expect(topupTermsError({ ...STEAM, markupBps: TOPUP_LIMITS.maxMarkupBps + 1 })).toMatch(/не больше 30%/);
    expect(topupTermsError({ ...STEAM, markupBps: -1 })).toMatch(/отрицательной/);
    expect(topupTermsError({ ...STEAM, markupBps: 7.5 })).toMatch(/целым числом/);
  });

  it('минимум больше максимума — отказ', () => {
    expect(topupTermsError({ ...STEAM, min: 200_000n, max: 100_000n })).toMatch(/Минимум больше/);
  });

  it('границы за пределами площадки — отказ', () => {
    expect(topupTermsError({ ...STEAM, min: 50n })).toMatch(/целые рубли|Минимум/);
    expect(topupTermsError({ ...STEAM, max: TOPUP_LIMITS.maxAmount + 100n })).toMatch(/Максимум/);
  });
});

describe('выбор предложения', () => {
  const cheapNarrow = { id: 'a', markupBps: 500, min: 50_000n, max: 200_000n };
  const wide = { id: 'b', markupBps: 800, min: 10_000n, max: 1_500_000n };
  const same = { id: 'c', markupBps: 800, min: 10_000n, max: 1_500_000n };

  it('берётся самая низкая наценка среди подходящих по сумме', () => {
    expect(pickTopupOffer([wide, cheapNarrow], 100_000n)?.id).toBe('a');
  });

  it('дешёвое, но не берущее сумму, пропускается', () => {
    expect(pickTopupOffer([cheapNarrow, wide], 20_000n)?.id).toBe('b');
  });

  it('при равной наценке — первое в списке', () => {
    expect(pickTopupOffer([wide, same], 100_000n)?.id).toBe('b');
  });

  it('никто не берёт сумму — null, а не «ближайшее»', () => {
    expect(pickTopupOffer([cheapNarrow], 10_000n)).toBeNull();
    expect(pickTopupOffer([], 10_000n)).toBeNull();
  });

  it('общие границы — от самого низкого минимума до самого высокого максимума', () => {
    expect(topupRange([cheapNarrow, wide])).toEqual({ min: 10_000n, max: 1_500_000n });
    expect(topupRange([])).toBeNull();
  });
});

describe('логин Steam', () => {
  it('обычный логин проходит', () => {
    expect(topupAccountError('steam', 'gamer_2007')).toBeNull();
    expect(topupAccountError('steam', '  gamer_2007  ')).toBeNull();
  });

  it('типичные ошибки названы по-человечески', () => {
    expect(topupAccountError('steam', '')).toMatch(/Укажите логин/);
    expect(topupAccountError('steam', 'me@mail.ru')).toMatch(/а не почта/);
    expect(topupAccountError('steam', 'Ivan Petrov')).toMatch(/имя профиля/);
    expect(topupAccountError('steam', 'геймер')).toMatch(/латиницей/);
    expect(topupAccountError('steam', 'ab')).toMatch(/от 3/);
  });

  it('у других игр — только непустой ID разумной длины', () => {
    expect(topupAccountError('genshin', '812345678')).toBeNull();
    expect(topupAccountError('genshin', 'Ник с пробелом')).toBeNull();
    expect(topupAccountError('genshin', ' ')).toMatch(/игровой ID/);
    expect(topupAccountError('genshin', 'x'.repeat(121))).toMatch(/длинный/);
  });
});

describe('подпись наценки', () => {
  it('целые и дробные проценты по-русски', () => {
    expect(markupLabel(800)).toBe('8%');
    expect(markupLabel(750)).toBe('7,5%');
    expect(markupLabel(0)).toBe('0%');
  });
});
