import { describe, expect, it } from 'vitest';
import { isWarrantyDays, warrantyActive, warrantyUntil } from './warranty';

describe('гарантия продавца', () => {
  it('срок — только из списка', () => {
    expect(isWarrantyDays(7)).toBe(true);
    expect(isWarrantyDays(8)).toBe(false);
    expect(isWarrantyDays(null)).toBe(false);
  });

  it('идёт после подтверждения, пока деньги у площадки и срок не вышел', () => {
    const until = warrantyUntil(new Date('2026-11-11T10:00:00Z'), 7);
    expect(until.toISOString()).toBe('2026-11-18T10:00:00.000Z');
    const mid = new Date('2026-11-15T10:00:00Z');
    expect(warrantyActive({ status: 'completed', warrantyUntil: until }, mid)).toBe(true);
    expect(warrantyActive({ status: 'completed', warrantyUntil: until, warrantyReleasedAt: mid }, mid)).toBe(false);
    expect(warrantyActive({ status: 'completed', warrantyUntil: until }, new Date('2026-11-19T00:00:00Z'))).toBe(false);
    expect(warrantyActive({ status: 'delivered', warrantyUntil: until }, mid)).toBe(false);
    expect(warrantyActive({ status: 'completed' }, mid)).toBe(false);
  });
});
