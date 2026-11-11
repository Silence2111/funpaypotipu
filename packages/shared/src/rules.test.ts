import { describe, expect, it } from 'vitest';
import { RULE_CLAUSES, ruleAnchor, ruleClause, ruleText } from './rules';

describe('пункты правил', () => {
  it('номера уникальны и идут группами', () => {
    const ids = RULE_CLAUSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('1.1');
  });

  it('пункт по номеру, якорь и текст решения', () => {
    expect(ruleClause('1.2')?.title).toMatch(/накрутка/);
    expect(ruleClause('9.9')).toBeNull();
    expect(ruleAnchor('3.2')).toBe('p-3-2');
    expect(ruleText('3.1')).toBe('п. 3.1 — Оскорбления и угрозы.');
    expect(ruleText(null)).toBeNull();
  });
});
