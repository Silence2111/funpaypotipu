import { describe, expect, it } from 'vitest';
import { actCutoff, chatCutoff, dealCutoff } from './retention';

describe('сроки хранения (часть 147)', () => {
  const now = new Date('2026-11-11T10:00:00Z');

  it('переписка — 3 года', () => {
    expect(chatCutoff(now).toISOString()).toBe('2023-11-11T10:00:00.000Z');
  });

  it('сделки — 5 полных лет после года сделки', () => {
    // В 2026-м к уничтожению — сделки 2020 года и раньше: 2021-я хранится до конца 2026-го.
    expect(dealCutoff(now).toISOString()).toBe('2021-01-01T00:00:00.000Z');
    expect(dealCutoff(new Date('2027-01-01T00:00:00Z')).toISOString()).toBe('2022-01-01T00:00:00.000Z');
  });

  it('акты — 3 года', () => {
    expect(actCutoff(now).toISOString()).toBe('2023-11-11T10:00:00.000Z');
  });
});
