import { describe, expect, it } from 'vitest';
import { isDemoSeller } from './demo';

describe('isDemoSeller', () => {
  it('узнаёт продавцов демо-витрины', () => {
    expect(isDemoSeller('keystore')).toBe(true);
  });
  it('живого продавца пометкой «Пример» не клеймит', () => {
    expect(isDemoSeller('keystore2')).toBe(false);
    expect(isDemoSeller(null)).toBe(false);
  });
});
