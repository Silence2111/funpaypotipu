import { describe, expect, it } from 'vitest';
import { repriceError, repriced } from './reprice';

describe('правка цен разом', () => {
  it('цена в рублях остаётся в рублях, с копейками — до копейки', () => {
    expect(repriced(99_900n, 7)).toBe(106_900n); // 999 ₽ +7% — 1 068,93 → 1 069 ₽
    expect(repriced(150_000n, -10)).toBe(135_000n);
    expect(repriced(1_550n, 10)).toBe(1_705n); // 15,50 ₽ +10% — 17,05 ₽
    expect(repriced(1_555n, -3)).toBe(1_508n); // 15,0835 → 15,08 ₽
  });

  it('процент — целый, не ноль, от −50 до +100', () => {
    expect(repriceError(5)).toBeNull();
    expect(repriceError(-50)).toBeNull();
    expect(repriceError(0)).not.toBeNull();
    expect(repriceError(-60)).toMatch(/от −50% до \+100%/);
    expect(repriceError(2.5)).not.toBeNull();
  });
});
