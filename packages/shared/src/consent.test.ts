import { describe, expect, it } from 'vitest';
import { registerSchema } from './contracts/auth';
import { PD_CONSENT_VERSION } from './consent';

describe('согласие на обработку персональных данных', () => {
  const base = { email: 'a@b.ru', password: 'password123', username: 'newbie1' };

  it('регистрация без отдельного согласия не проходит — с ним проходит', () => {
    const none = registerSchema.safeParse(base);
    expect(none.success).toBe(false);
    expect(none.error?.issues[0]?.message).toBe('Нужно согласие на обработку персональных данных');
    expect(registerSchema.safeParse({ ...base, pdConsent: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, pdConsent: true }).success).toBe(true);
  });

  it('версия текста — дата редакции', () => {
    expect(PD_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
