import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { utc } from '../src/common/sql-time';

/**
 * Время в сыром SQL. Колонки — `timestamp(3)` в UTC без пояса; дата из JS
 * приходит как `timestamptz` и без `AT TIME ZONE 'UTC'` переводится в пояс
 * соединения. При московском поясе базы скидки кончались на 3 часа раньше,
 * «в сети» не было никого, сводка по дням не сходилась с итогом. Как это
 * ведёт себя в базе, проверяет e2e: в CI база стоит в Europe/Moscow.
 */

describe('utc() для сырого SQL', () => {
  it('дата — параметром, перевод — в UTC, а не в пояс соединения', () => {
    const d = new Date('2026-11-10T12:00:00.000Z');
    const sql = utc(d);
    expect(sql.text).toBe(`($1::timestamptz AT TIME ZONE 'UTC')`);
    expect(sql.values).toEqual([d]);
  });

  it('в сырых запросах API нет `= now()` и `${new Date()}` без utc()', () => {
    const SRC = join(__dirname, '../src');
    const files: string[] = [];
    (function walk(dir: string) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    })(SRC);
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      // Только внутри шаблонов сырого SQL: `…` после $queryRaw, $executeRaw, Prisma.sql.
      for (const m of text.matchAll(/(?:\$queryRaw|\$executeRaw|Prisma\.sql)(?:<[^`]*?>)?\s*`([^`]*)`/g)) {
        const body = m[1]!;
        if (/\bnow\(\)|current_timestamp|\$\{\s*new Date\(/i.test(body)) bad.push(`${f.slice(SRC.length)}: ${body.trim().slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
