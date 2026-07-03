import { describe, expect, it } from 'vitest';
import { maskContacts } from './masking';

describe('maskContacts', () => {
  it('маскирует email', () => {
    const r = maskContacts('пиши на mail@example.com');
    expect(r.masked).not.toContain('example.com');
    expect(r.flagged).toBe(true);
  });

  it('маскирует телефон', () => {
    const r = maskContacts('мой номер +7 999 123-45-67');
    expect(r.masked).not.toMatch(/\d{3}/);
    expect(r.flagged).toBe(true);
  });

  it('маскирует ссылку', () => {
    expect(maskContacts('тут https://t.me/user').masked).toContain('[скрыто]');
    expect(maskContacts('заходи на example.ru').flagged).toBe(true);
  });

  it('маскирует @ник', () => {
    const r = maskContacts('мой ник @durov_official');
    expect(r.masked).not.toContain('durov');
    expect(r.flagged).toBe(true);
  });

  it('маскирует упоминание мессенджера', () => {
    expect(maskContacts('давай в телеграм').flagged).toBe(true);
    expect(maskContacts('go to Discord').flagged).toBe(true);
  });

  it('не трогает обычный текст', () => {
    const r = maskContacts('Здравствуйте, аккаунт ещё в продаже?');
    expect(r.flagged).toBe(false);
    expect(r.masked).toBe('Здравствуйте, аккаунт ещё в продаже?');
  });
});
