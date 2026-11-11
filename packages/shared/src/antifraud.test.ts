import { describe, expect, it } from 'vitest';
import { ANTIFRAUD_DEFAULTS, antifraudSettings, isNewbie } from './antifraud';

describe('защита от мошенничества', () => {
  it('настройки: сохранённое поверх значений по умолчанию, мусор и выход за пределы — по умолчанию', () => {
    expect(antifraudSettings(null)).toEqual(ANTIFRAUD_DEFAULTS);
    const s = antifraudSettings({ enabled: false, newbiePayDay: 500_000, paymentsPerHour: 1, newbieLotsPerDay: '5', blockLinkedDeals: false });
    expect(s.enabled).toBe(false);
    expect(s.newbiePayDay).toBe(500_000);
    expect(s.paymentsPerHour).toBe(ANTIFRAUD_DEFAULTS.paymentsPerHour);
    expect(s.newbieLotsPerDay).toBe(ANTIFRAUD_DEFAULTS.newbieLotsPerDay);
    expect(s.blockLinkedDeals).toBe(false);
    expect(antifraudSettings({}, { ...ANTIFRAUD_DEFAULTS, enabled: false }).enabled).toBe(false);
  });

  it('новичок — моложе 72 ч и без завершённых сделок', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    expect(isNewbie(new Date('2026-11-10T12:00:00Z'), 0, now)).toBe(true);
    expect(isNewbie(new Date('2026-11-10T12:00:00Z'), 1, now)).toBe(false);
    expect(isNewbie(new Date('2026-11-08T11:00:00Z'), 0, now)).toBe(false);
  });
});
