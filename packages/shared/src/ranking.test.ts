import { describe, it, expect } from 'vitest';
import {
  RANK_RULES,
  THRESHOLD_CLAIM,
  THRESHOLD_TALK,
  benchmark,
  concordance,
  requiredOutcomes,
  type RankCandidate,
} from './ranking';

/**
 * Проверяются свойства самого замера, а не «алгоритм хороший»: что он
 * отказывается считать без данных, не путает категории и не выдаёт незнание
 * за знание. Если замер соврёт, его цифра уйдёт на витрину.
 */

const c = (key: string, clean: boolean | null, over: Partial<RankCandidate> = {}): RankCandidate => ({
  key,
  group: 'g',
  price: 1000,
  sellerSalesBefore: 0,
  sellerRatingBefore: null,
  listedAt: 0,
  clean,
  ...over,
});

describe('метрика согласованности', () => {
  it('идеальный порядок — 1, обратный — 0', () => {
    const cands = [c('a', true, { price: 100 }), c('b', false, { price: 900 })];
    expect(concordance(cands, RANK_RULES['дешевле_сверху'])!.share).toBe(1);
    const back = [c('a', true, { price: 900 }), c('b', false, { price: 100 })];
    expect(concordance(back, RANK_RULES['дешевле_сверху'])!.share).toBe(0);
  });

  it('лоты из разных категорий не сравниваются: они не конкурировали', () => {
    const cands = [c('a', true, { group: 'x' }), c('b', false, { group: 'y' })];
    expect(concordance(cands, RANK_RULES['дешевле_сверху'])).toBeNull();
  });

  it('правило, которое не различает лоты, даёт монетку, а не 1.0', () => {
    // Стабилизатор по id не должен превращать «не знаю» в «знаю».
    const cands = [c('a', true), c('b', false)];
    expect(concordance(cands, RANK_RULES['по_сделкам_продавца'])!.share).toBe(0.5);
  });

  it('незавершённые заказы в пары не попадают', () => {
    expect(concordance([c('a', true), c('b', null)], RANK_RULES['дешевле_сверху'])).toBeNull();
  });
});

describe('порог объёма данных', () => {
  it('выводится из формулы и растёт при уменьшении эффекта', () => {
    expect(requiredOutcomes(0.05)).toBeGreaterThan(requiredOutcomes(0.1));
    expect(THRESHOLD_CLAIM).toBeGreaterThan(THRESHOLD_TALK);
  });
  it('нулевой эффект — бесконечность, не число', () => {
    expect(() => requiredOutcomes(0)).toThrow();
  });
});

describe('отказ считать — это результат, а не ошибка', () => {
  it('на пустой базе замер не считает и называет пороги', () => {
    const r = benchmark([]);
    expect(r.measured).toBe(false);
    expect(r.verdict).toContain('Замер невозможен');
    expect(r.verdict).toContain(String(THRESHOLD_TALK));
    expect(r.verdict).toContain(String(THRESHOLD_CLAIM));
  });

  it('на демо-данных замер не считает, даже если их много', () => {
    const many = Array.from({ length: 200 }, (_, i) => c(`k${i}`, i % 2 === 0));
    const r = benchmark(many, { demoOnly: true });
    expect(r.measured).toBe(false);
    expect(r.verdict).toContain('демонстрационные');
  });

  it('на один проблемный заказ ниже порога — закрыт', () => {
    const cands = [
      ...Array.from({ length: THRESHOLD_TALK }, (_, i) => c(`g${i}`, true)),
      ...Array.from({ length: THRESHOLD_TALK - 1 }, (_, i) => c(`b${i}`, false)),
    ];
    expect(benchmark(cands).measured).toBe(false);
  });
});

describe('инструмент запустится на первом наполнении', () => {
  // Синтетика только для проверки инструмента — это не замер продукта,
  // цифра отсюда никуда не идёт.
  const filled = [
    ...Array.from({ length: THRESHOLD_TALK }, (_, i) =>
      c(`g${i}`, true, { sellerSalesBefore: 20, sellerRatingBefore: 4.9, price: 1000 + i }),
    ),
    ...Array.from({ length: THRESHOLD_TALK }, (_, i) => c(`b${i}`, false, { price: 900 + i })),
  ];

  it('на пороге считает все правила и сравнивает наше с тривиальным', () => {
    const r = benchmark(filled);
    expect(r.measured).toBe(true);
    expect(Object.keys(r.results)).toHaveLength(Object.keys(RANK_RULES).length);
    expect(r.verdict).toMatch(/лучше|хуже/);
  });

  it('между порогами предупреждает, что разница внутри погрешности', () => {
    const r = benchmark(filled);
    expect(r.verdict).toContain('погрешности');
    expect(r.caveats.some((x) => x.includes(String(THRESHOLD_CLAIM)))).toBe(true);
  });
});
