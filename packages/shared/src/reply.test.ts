import { describe, expect, it } from 'vitest';
import {
  REPLY_CAP_SEC,
  REPLY_SAMPLES,
  addReplySample,
  normalizeCommand,
  replyTime,
  type ReplySample,
} from './reply';

const NOW = Date.UTC(2026, 9, 21, 12);
const sec = (ms: number) => Math.floor(ms / 1000);
/** Ответы минуту назад с такими ожиданиями, в секундах. */
const recent = (...waits: number[]): ReplySample[] => waits.map((w) => [sec(NOW) - 60, w]);

describe('команда', () => {
  it('регистр, пробелы и «ё» не важны', () => {
    expect(normalizeCommand('  !Оплата  ')).toBe('!оплата');
    expect(normalizeCommand('Как   ВЫДАЁТЕ')).toBe('как выдаете');
  });
});

describe('время ответа', () => {
  it('меньше трёх ответов — не показываем', () => {
    expect(replyTime([])).toBeNull();
    expect(replyTime(recent(60, 60), NOW)).toBeNull();
    expect(replyTime(null, NOW)).toBeNull();
  });

  it('медиана, а не среднее: одна ночь не портит цифру', () => {
    expect(replyTime(recent(120, 180, 240, 20 * 3600), NOW)).toBe('min5');
    expect(replyTime(recent(600, 700, 800), NOW)).toBe('min15');
    expect(replyTime(recent(1800, 3000, 3600), NOW)).toBe('hour');
    expect(replyTime(recent(2 * 3600, 2 * 3600, 3 * 3600), NOW)).toBe('hours3');
    expect(replyTime(recent(5 * 3600, 8 * 3600, 3 * 3600 + 1), NOW)).toBe('day');
  });

  it('ответы старше двух месяцев не в счёт', () => {
    const old: ReplySample[] = [[sec(NOW) - 61 * 86400, 60]];
    expect(replyTime([...recent(60, 60), ...old], NOW)).toBeNull();
  });

  it('новый ответ — в начало, хранятся последние 20, ожидание не больше суток', () => {
    let s: unknown = 'мусор';
    for (let i = 0; i < 25; i++) s = addReplySample(s, new Date(NOW + i * 1000), i);
    const list = s as ReplySample[];
    expect(list).toHaveLength(REPLY_SAMPLES);
    expect(list[0]).toEqual([sec(NOW) + 24, 24]);
    expect(addReplySample([], new Date(NOW), 3 * 86400)[0]![1]).toBe(REPLY_CAP_SEC);
    expect(addReplySample([[1, 'x'], 5], new Date(NOW), -3)).toEqual([[sec(NOW), 0]]);
  });
});
