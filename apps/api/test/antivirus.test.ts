import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanService } from '../src/modules/antivirus/scan.service';

/**
 * Проверка вложений антивирусом.
 *
 * Главный вопрос здесь не «ловим ли вирус» (это работа ClamAV), а **что
 * происходит, когда антивирус недоступен**. Раньше файл молча считался
 * чистым: удобно, сервис не встаёт — и ровно поэтому «уронить clamd»
 * становилось способом залить вредонос на маркетплейс.
 */

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}' + '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

function service() {
  return new ScanService();
}

describe('эвристика без ClamAV', () => {
  beforeEach(() => {
    delete process.env.CLAMAV_HOST;
  });

  it('обычный файл проходит', async () => {
    expect((await service().scan(Buffer.from('просто картинка'))).clean).toBe(true);
  });

  it('тестовая сигнатура EICAR не проходит', async () => {
    const r = await service().scan(Buffer.from(EICAR));
    expect(r.clean).toBe(false);
    expect(r.reason).toContain('EICAR');
  });

  it('сигнатура внутри большого файла тоже ловится', async () => {
    const padded = Buffer.concat([Buffer.alloc(1024, 0x41), Buffer.from(EICAR)]);
    expect((await service().scan(padded)).clean).toBe(false);
  });

  it('слишком большой файл отклоняется с понятной причиной', async () => {
    process.env.ATTACHMENT_MAX_BYTES = '10';
    const r = await service().scan(Buffer.alloc(100));
    expect(r.clean).toBe(false);
    expect(r.reason).toContain('лимит');
  });

  it('пустой файл не роняет проверку', async () => {
    expect((await service().scan(Buffer.alloc(0))).clean).toBe(true);
  });
});

describe('когда антивирус недоступен', () => {
  beforeEach(() => {
    // Порт, на котором заведомо никто не слушает
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = '1';
  });

  it('в production файл отклоняется, а не пропускается', async () => {
    // Ради этой строки всё и переписано: непроверенный файл на маркетплейсе
    // цифровых товаров опаснее, чем недоступная загрузка
    process.env.NODE_ENV = 'production';
    delete process.env.ANTIVIRUS_FAIL_MODE;
    const r = await service().scan(Buffer.from('что угодно'));
    expect(r.clean).toBe(false);
    expect(r.reason).toContain('недоступна');
  });

  it('в разработке файл пропускается — иначе локально ничего не загрузить', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ANTIVIRUS_FAIL_MODE;
    expect((await service().scan(Buffer.from('что угодно'))).clean).toBe(true);
  });

  it('режим задаётся явно и перебивает окружение', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ANTIVIRUS_FAIL_MODE = 'open';
    expect((await service().scan(Buffer.from('x'))).clean).toBe(true);

    process.env.NODE_ENV = 'development';
    process.env.ANTIVIRUS_FAIL_MODE = 'closed';
    expect((await service().scan(Buffer.from('x'))).clean).toBe(false);
  });

  it('непонятное значение режима не открывает прод', async () => {
    // Безопасная сторона по умолчанию: опечатка в переменной не должна
    // тихо превращать fail-closed в fail-open
    process.env.NODE_ENV = 'production';
    process.env.ANTIVIRUS_FAIL_MODE = 'да';
    expect((await service().scan(Buffer.from('x'))).clean).toBe(false);
  });

  it('лимит размера проверяется до похода в антивирус', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ATTACHMENT_MAX_BYTES = '10';
    const r = await service().scan(Buffer.alloc(100));
    expect(r.reason).toContain('лимит');
  });
});
