import { describe, expect, it } from 'vitest';
import { formatPhone, maskPhone, normalizeRuPhone, phoneCodeText } from './phone';

describe('номер телефона', () => {
  it.each([
    ['+7 (999) 123-45-67', '+79991234567'],
    ['8 999 123 45 67', '+79991234567'],
    ['79991234567', '+79991234567'],
    ['9991234567', '+79991234567'],
    [' +7-912-000-11-22 ', '+79120001122'],
  ])('российский мобильный: %s', (raw, phone) => {
    expect(normalizeRuPhone(raw)).toBe(phone);
  });

  it.each([
    '+7 701 123 45 67', // Казахстан
    '+7 495 123 45 67', // городской
    '+380 99 123 45 67',
    '12345',
    '',
    null,
  ])('не принимаем: %s', (raw) => {
    expect(normalizeRuPhone(raw)).toBeNull();
  });

  it('пишем и прячем номер', () => {
    expect(formatPhone('+79991234567')).toBe('+7 999 123-45-67');
    expect(maskPhone('+79991234567')).toBe('+7 999 ***-**-67');
  });

  it('в SMS — код и предупреждение', () => {
    expect(phoneCodeText('123456')).toMatch(/^123456 — код входа на GameMarket/);
    expect(phoneCodeText('123456')).toContain('Никому не сообщайте');
  });
});
