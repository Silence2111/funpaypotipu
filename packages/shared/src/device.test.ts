import { describe, expect, it } from 'vitest';
import { deviceOf } from './device';

describe('устройство по строке браузера', () => {
  it('браузер и система; по-английски — английские слова', () => {
    const chromeWin =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const yandexAndroid =
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 YaBrowser/24.10 Mobile Safari/537.36';
    const safariIphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(deviceOf(chromeWin)).toBe('Chrome · Windows');
    expect(deviceOf(yandexAndroid)).toBe('Яндекс Браузер · Android');
    expect(deviceOf(yandexAndroid, 'en')).toBe('Yandex Browser · Android');
    expect(deviceOf(safariIphone)).toBe('Safari · iOS');
    expect(deviceOf('curl/8.0')).toBe('Браузер');
    expect(deviceOf(null, 'en')).toBe('Unknown device');
  });
});
