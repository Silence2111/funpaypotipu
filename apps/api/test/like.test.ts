import { describe, expect, it } from 'vitest';
import { containsText, likeText } from '../src/common/like';

/** Поиск «содержит»: «%», «_» и «\» в тексте — обычные знаки, а не подстановка ILIKE. */
describe('текст для поиска', () => {
  it('экранирует «%», «_» и «\\», остальное — как есть', () => {
    expect(likeText('anna_smirnova')).toBe('anna\\_smirnova');
    expect(likeText('скидка 50%')).toBe('скидка 50\\%');
    expect(likeText('a\\b')).toBe('a\\\\b');
    expect(likeText('Аккаунт CS2 Prime')).toBe('Аккаунт CS2 Prime');
  });

  it('условие Prisma — содержит, без учёта регистра', () => {
    expect(containsText('50%_')).toEqual({ contains: '50\\%\\_', mode: 'insensitive' });
  });
});
