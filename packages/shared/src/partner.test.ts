import { describe, expect, it } from 'vitest';
import {
  PARTNER_DEFAULTS,
  newPartnerCode,
  normalizePartnerCode,
  partnerActive,
  partnerSettings,
  partnerShare,
  withinPartnerTerm,
} from './partner';

describe('партнёрская программа', () => {
  it('по умолчанию выключена и без цифр; битые настройки — выключено', () => {
    expect(PARTNER_DEFAULTS).toEqual({ enabled: false, shareBps: 0, termDays: 0 });
    expect(partnerSettings(null)).toEqual(PARTNER_DEFAULTS);
    expect(partnerSettings({ enabled: true, shareBps: 9000, termDays: 30 })).toEqual(PARTNER_DEFAULTS);
    expect(partnerSettings({ enabled: true, shareBps: 1.5, termDays: 30 })).toEqual(PARTNER_DEFAULTS);
    expect(partnerSettings({ enabled: 'yes', shareBps: 2000, termDays: 90 })).toEqual({
      enabled: false,
      shareBps: 2000,
      termDays: 90,
    });
  });

  it('работает, только когда включена и заданы доля и срок', () => {
    expect(partnerActive({ enabled: true, shareBps: 2000, termDays: 180 })).toBe(true);
    expect(partnerActive({ enabled: true, shareBps: 0, termDays: 180 })).toBe(false);
    expect(partnerActive({ enabled: true, shareBps: 2000, termDays: 0 })).toBe(false);
    expect(partnerActive({ enabled: false, shareBps: 2000, termDays: 180 })).toBe(false);
  });

  it('доля — от остатка площадки, вниз до копейки; минус и ноль — ничего', () => {
    expect(partnerShare(4567n, 2000)).toBe(913n);
    expect(partnerShare(0n, 2000)).toBe(0n);
    expect(partnerShare(-300n, 2000)).toBe(0n);
    expect(partnerShare(10000n, 0)).toBe(0n);
  });

  it('срок — от привязки, включительно; до привязки — нет', () => {
    const at = new Date('2026-11-01T00:00:00Z');
    expect(withinPartnerTerm(at, new Date('2026-12-01T00:00:00Z'), 30)).toBe(true);
    expect(withinPartnerTerm(at, new Date('2026-12-01T00:00:01Z'), 30)).toBe(false);
    expect(withinPartnerTerm(at, new Date('2026-10-31T23:59:59Z'), 30)).toBe(false);
  });

  it('код — заглавными, без путаных 0/O/1/I; новый проходит проверку', () => {
    expect(normalizePartnerCode(' abc234de ')).toBe('ABC234DE');
    expect(normalizePartnerCode('ABC0OI1')).toBeNull();
    expect(normalizePartnerCode('AB')).toBeNull();
    expect(normalizePartnerCode(null)).toBeNull();
    let i = 0;
    const code = newPartnerCode(() => (i++ % 10) / 10);
    expect(normalizePartnerCode(code)).toBe(code);
  });
});
