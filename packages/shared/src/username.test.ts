import { describe, expect, it } from 'vitest';
import { suggestUsername, usernameSchema } from './contracts/auth';

describe('ник из имени в сервисе', () => {
  it('кириллица — латиницей, пробелы — подчёркиванием', () => {
    expect(suggestUsername('Мирослава Ким')).toBe('miroslava_kim');
    expect(suggestUsername('Щукин Ёжик')).toBe('schukin_ezhik');
  });

  it('ник из Telegram — как есть, если подходит', () => {
    expect(suggestUsername('Ivan_Petrov', 'Иван')).toBe('ivan_petrov');
  });

  it('пустое и короткое — следующий вариант, потом «player»', () => {
    expect(suggestUsername(null, 'ab', 'Анна')).toBe('anna');
    expect(suggestUsername('###', '')).toBe('player');
  });

  it('подсказка проходит те же правила, что ник при регистрации', () => {
    for (const name of ['Мирослава Ким', 'John  O’Connor', 'Пётр-1-й']) {
      expect(usernameSchema.safeParse(suggestUsername(name)).success).toBe(true);
    }
  });
});
