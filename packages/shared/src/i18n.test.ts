import { describe, expect, it } from 'vitest';
import { EN_SHARED, preferredLang, translateText } from './i18n';
import { NOTIFY_GROUPS, NOTIFY_LABELS } from './notify';
import { PAYMENT_METHODS } from './payment';
import { PAYOUT_REJECT_REASONS, WITHDRAWAL_METHODS } from './withdrawal';
import { SELLER_LEVELS } from './seller-level';
import { buyerDataError } from './buyer-data';
import { benchmark, RANK_RULES } from './ranking';

const tr = (s: string) => translateText(EN_SHARED, s);
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translateText', () => {
  it('точная фраза и фраза с подстановкой', () => {
    expect(tr('Лот закончился')).toBe('Out of stock');
    expect(tr('Минимум — 500 ₽')).toBe('Minimum is 500 ₽');
  });

  it('более точный шаблон выигрывает', () => {
    expect(tr('Минимум — от 100 ₽')).toBe('Minimum must be at least 100 ₽');
    expect(tr('Максимум — не больше 50 000 ₽')).toBe('Maximum can’t exceed 50 000 ₽');
  });

  it('подставленное значение тоже переводится', () => {
    expect(translateText({ ...EN_SHARED, золота: 'gold' }, 'Минимум — 3 золота')).toBe(
      'Minimum is 3 gold',
    );
  });

  it('без перевода — undefined', () => {
    expect(tr('Совсем новая фраза')).toBeUndefined();
  });
});

describe('EN_SHARED', () => {
  it('переводы без русских букв и с теми же подстановками', () => {
    for (const [ru, en] of Object.entries(EN_SHARED)) {
      expect(en, ru).not.toMatch(/[а-яё]/i);
      expect(holes(en), ru).toEqual(holes(ru));
    }
  });

  it('подписи общих модулей переведены все', () => {
    const labels = [
      ...Object.values(NOTIFY_LABELS),
      ...NOTIFY_GROUPS.flatMap((g) => [g.label, g.hint]),
      ...PAYMENT_METHODS.map((m) => m.label),
      ...WITHDRAWAL_METHODS.map((m) => m.label),
      ...PAYOUT_REJECT_REASONS,
      ...Object.values(SELLER_LEVELS).map((l) => l.label),
      ...Object.keys(RANK_RULES),
    ];
    for (const label of labels.filter((l) => /[а-яё]/i.test(l)))
      expect(tr(label), label).toBeDefined();
  });

  it('проверки данных покупателя и замер выдачи переводятся целиком', () => {
    const err = buyerDataError([{ label: 'Ник в игре', required: true }], {});
    expect(err && tr(err)).toBe('Fill in “Ник в игре”');
    const report = benchmark([], { demoOnly: true });
    expect(tr(report.verdict)).toMatch(/^Can’t measure: the database has only demo orders/);
  });
});

describe('preferredLang', () => {
  it('русский среди языков браузера — русский, иначе английский', () => {
    expect(preferredLang('en-US,en;q=0.9,ru;q=0.8')).toBe('ru');
    expect(preferredLang('kk-KZ')).toBe('ru');
    expect(preferredLang('de-DE,en;q=0.8')).toBe('en');
  });

  it('без языка — русский: роботы, вебхуки, fetch в Node', () => {
    expect(preferredLang(undefined)).toBe('ru');
    expect(preferredLang('')).toBe('ru');
    expect(preferredLang('*')).toBe('ru');
    expect(preferredLang(['en', 'ru'])).toBe('ru');
  });
});
