import { describe, expect, it } from 'vitest';
import { maskContacts, maskContactsExcept } from './masking';

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

describe('maskContactsExcept', () => {
  it('ники участников диалога не скрываются, контакты рядом — скрываются', () => {
    const r = maskContactsExcept('Stb73721881, звоните 89161234567', ['stb73721881', 'seller']);
    expect(r.masked).toBe('Stb73721881, звоните [скрыто]');
    expect(r.flagged).toBe(true);
    expect(maskContactsExcept('telegram_fan, спасибо', ['telegram_fan'])).toEqual({
      masked: 'telegram_fan, спасибо',
      flagged: false,
    });
  });

  it('ник внутри @ника, почты или ссылки не спасает контакт', () => {
    const names = ['seller', 'stb73721881'];
    expect(maskContactsExcept('пиши @seller_tg', names).masked).toBe('пиши [скрыто]');
    expect(maskContactsExcept('seller@mail.ru', names).masked).toBe('[скрыто]');
    expect(maskContactsExcept('t.me/stb73721881', names).masked).not.toContain('7372');
    expect(maskContactsExcept('Спасибо, stb73721881.', names)).toEqual({
      masked: 'Спасибо, stb73721881.',
      flagged: false,
    });
  });

  it('ник, который целиком контакт, скрывается как обычно', () => {
    expect(maskContactsExcept('пиши 89161234567', ['89161234567']).masked).toBe('пиши [скрыто]');
    expect(maskContactsExcept('я в telegram', ['telegram']).flagged).toBe(true);
  });
});
