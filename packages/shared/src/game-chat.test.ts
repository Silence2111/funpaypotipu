import { describe, expect, it } from 'vitest';
import { chatFingerprint, isShouting } from './game-chat';

describe('общий чат игры', () => {
  it('повтор — тот же текст без регистра, пробелов и знаков', () => {
    expect(chatFingerprint('Скупаю СКИНЫ!!!  ')).toBe(chatFingerprint('скупаю скины'));
    expect(chatFingerprint('Ёлка')).toBe(chatFingerprint('елка'));
    expect(chatFingerprint('скупаю скины')).not.toBe(chatFingerprint('продаю скины'));
  });

  it('крик — больше 70% заглавных от 12 букв', () => {
    expect(isShouting('СКУПАЮ ВСЕ СКИНЫ ДОРОГО')).toBe(true);
    expect(isShouting('Скупаю AWP и AK-47 дорого')).toBe(false);
    expect(isShouting('ОК ДА')).toBe(false);
  });
});
