import { describe, expect, it } from 'vitest';
import { EN_SHARED, translateText } from './i18n';
import {
  LEDGER_OPERATIONS,
  OTHER_OPERATION,
  csvDate,
  csvMoney,
  operationLabel,
  parsePeriod,
  toCsv,
} from './statement';

describe('период выписки', () => {
  const now = new Date('2026-10-21T21:30:00Z'); // по Москве уже 22 октября

  it('без дат — последние 30 дней по Москве, конец не включается', () => {
    const p = parsePeriod(undefined, undefined, now);
    expect(p).toMatchObject({ fromDay: '2026-09-23', toDay: '2026-10-22' });
    if ('error' in p) throw new Error(p.error);
    expect(p.from.toISOString()).toBe('2026-09-22T21:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-10-22T21:00:00.000Z');
  });

  it('ошибки: формат, порядок, больше года', () => {
    expect(parsePeriod('21.10.2026', undefined, now)).toEqual({
      error: 'Даты — в виде ГГГГ-ММ-ДД',
    });
    expect(parsePeriod('2026-10-10', '2026-10-01', now)).toEqual({
      error: 'Начало периода позже конца',
    });
    expect(parsePeriod('2024-01-01', '2026-01-01', now)).toEqual({
      error: 'Период — не больше 366 дней',
    });
    expect(parsePeriod('2026-10-21', '2026-10-21', now)).not.toHaveProperty('error');
  });
});

describe('CSV для Excel', () => {
  it('BOM, «;» по-русски и «,» по-английски, кавычки по правилам', () => {
    const rows = [
      ['Лот', 'Сумма'],
      ['Аккаунт; с "Prime"', csvMoney(150050n, 'ru')],
    ];
    expect(toCsv(rows, 'ru')).toBe('\uFEFFЛот;Сумма\r\n"Аккаунт; с ""Prime""";1500,50\r\n');
    expect(toCsv([['a,b', csvMoney(-99n, 'en')]], 'en')).toBe('\uFEFF"a,b",-0.99\r\n');
  });

  it('текст как формула не выполнится, а отрицательная сумма остаётся числом', () => {
    const csv = toCsv([['=HYPERLINK("http://evil")', '-1', csvMoney(-2500n, 'ru')]], 'ru');
    expect(csv).toBe('\uFEFF"\'=HYPERLINK(""http://evil"")";\'-1;-25,00\r\n');
  });

  it('дата по Москве', () => {
    const d = new Date('2026-10-21T21:30:00Z');
    expect(csvDate(d, 'ru').raw).toBe('22.10.2026 00:30');
    expect(csvDate(d, 'en').raw).toBe('2026-10-22 00:30');
  });
});

describe('операции', () => {
  it('неизвестная — «Операция»; у всех подписей есть английский', () => {
    expect(operationLabel('order_release')).toBe('Зачисление за продажу');
    expect(operationLabel('something_new')).toBe(OTHER_OPERATION);
    for (const label of [...Object.values(LEDGER_OPERATIONS), OTHER_OPERATION])
      expect(translateText(EN_SHARED, label), label).toBeDefined();
  });
});
