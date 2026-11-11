import { describe, expect, it } from 'vitest';
import { titleCapsShare, titleEmojiCount, titleNoiseError } from './listing-title';

describe('название лота (часть 143)', () => {
  it('обычные названия проходят', () => {
    for (const t of [
      'AK-47 | Красная линия, после полевых',
      'AWP | Dragon Lore (FN)',
      'Аккаунт CS2 Prime, 2000 часов',
      '🔥 Аккаунт с ножом',
      'Ключ GTA V Premium Edition',
      'M4A1-S Hyper Beast — FT',
      'CS2 AWP',
    ]) {
      expect(titleNoiseError(t), t).toBeNull();
    }
  });

  it('гирлянда эмодзи — нет', () => {
    expect(titleEmojiCount('🧅АВТОВЫДАЧА🧅 нож 🔪')).toBe(3);
    expect(titleNoiseError('🧅Автовыдача🧅 нож 🔪')).toMatch(/эмодзи/);
    expect(titleNoiseError('🧅 Нож 🧅')).toBeNull();
  });

  it('название заглавными — нет, короткие сокращения — да', () => {
    expect(titleCapsShare('AWP FN')).toBe(0);
    expect(titleNoiseError('АВТОВЫДАЧА НОЖ КЕРАМБИТ')).toMatch(/заглавными/);
    expect(titleNoiseError('АККАУНТ FORTNITE дёшево')).toMatch(/заглавными/);
  });

  it('повторы знаков — нет', () => {
    expect(titleNoiseError('Дёшево!!! Нож')).toMatch(/повторов/);
    expect(titleNoiseError('*** Нож ***')).toMatch(/повторов/);
    expect(titleNoiseError('Нож... почти новый')).toBeNull();
    expect(titleNoiseError('Нож! Почти новый')).toBeNull();
  });
});
