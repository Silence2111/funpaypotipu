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

describe('ник демо-продавца при регистрации', () => {
  it('занят: иначе живой продавец получил бы пометку «Пример» на всех лотах', async () => {
    const { registerSchema } = await import('./contracts/auth');
    const r = registerSchema.safeParse({ email: 'a@b.ru', password: 'password123', username: 'goldsmith' });
    expect(r.success).toBe(false);
    expect(registerSchema.safeParse({ email: 'a@b.ru', password: 'password123', username: 'goldsmith2' }).success).toBe(true);
  });
});
