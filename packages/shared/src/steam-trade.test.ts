import { describe, expect, it } from 'vitest';
import { buyerDataError, isSteamTradeUrl } from './buyer-data';

describe('ссылка на обмен Steam (часть 142)', () => {
  it('формат проверяется', () => {
    expect(isSteamTradeUrl('https://steamcommunity.com/tradeoffer/new/?partner=123456789&token=AbC-d_1x')).toBe(true);
    expect(isSteamTradeUrl('steamcommunity.com/tradeoffer/new/?partner=1&token=abcdefgh')).toBe(false);
    expect(isSteamTradeUrl('https://steamcommunity.com/profiles/7656119')).toBe(false);
  });

  it('поле «steam_trade» — с проверкой, обычное — без', () => {
    const fields = [{ label: 'Ссылка на обмен Steam', required: true, kind: 'steam_trade' as const }];
    expect(buyerDataError(fields, { 'Ссылка на обмен Steam': 'мой ник' })).toMatch(/вида https/);
    expect(buyerDataError(fields, { 'Ссылка на обмен Steam': 'https://steamcommunity.com/tradeoffer/new/?partner=42&token=abcdefgh' })).toBeNull();
    expect(buyerDataError([{ label: 'Ник', required: true }], { Ник: 'мой ник' })).toBeNull();
  });
});
