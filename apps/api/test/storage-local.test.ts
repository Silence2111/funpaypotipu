import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from '../src/modules/storage/storage.service';

/**
 * Хранилище на диске, когда S3 не задан. Раньше без S3 хранилище
 * выключалось целиком: на стенде не работали ни фото лотов, ни вложения.
 * Ссылки подписаны, как presigned у S3: чужой ключ, другая операция или
 * истёкший срок не проходят, а ключ не выводит за пределы папки.
 */

const dir = mkdtempSync(join(tmpdir(), 'gm-storage-'));
let storage: StorageService;

beforeAll(async () => {
  delete process.env.S3_ENDPOINT;
  process.env.STORAGE_DIR = dir;
  storage = new StorageService();
  await storage.onModuleInit();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const parts = (url: string) => {
  const u = new URL(url, 'http://x');
  return {
    path: u.pathname,
    key: u.searchParams.get('key')!,
    exp: u.searchParams.get('exp')!,
    sig: u.searchParams.get('sig')!,
  };
};

describe('хранилище на диске', () => {
  it('включено без S3', () => {
    expect(storage.enabled).toBe(true);
  });

  it('файл записывается и читается обратно', async () => {
    await storage.put('chat/c1/a.png', Buffer.from('png-bytes'), 'image/png');
    expect((await storage.getBytes('chat/c1/a.png')).toString()).toBe('png-bytes');
    await storage.remove('chat/c1/a.png');
    await expect(storage.getBytes('chat/c1/a.png')).rejects.toThrow();
  });

  it('подписанная ссылка проходит только для своего ключа и своей операции', async () => {
    const put = parts(await storage.presignPut('chat/c1/b.png'));
    expect(put.path).toBe('/api/assets/upload');
    expect(storage.verifyLocal('upload', put.key, put.exp, put.sig)).toBe(true);
    expect(storage.verifyLocal('file', put.key, put.exp, put.sig)).toBe(false);
    expect(storage.verifyLocal('upload', 'chat/c1/other.png', put.exp, put.sig)).toBe(false);
    expect(storage.verifyLocal('upload', put.key, String(Number(put.exp) + 60), put.sig)).toBe(
      false,
    );
  });

  it('истёкшая ссылка не проходит', async () => {
    const get = parts(await storage.presignGet('chat/c1/b.png', -1));
    expect(storage.verifyLocal('file', get.key, get.exp, get.sig)).toBe(false);
  });

  it('ключ не выводит за пределы папки', async () => {
    await expect(
      storage.put('chat/../../etc/passwd', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow();
    await expect(storage.getBytes('/etc/passwd')).rejects.toThrow();
    expect(storage.verifyLocal('file', 'chat/../x', String(Date.now()), 'sig')).toBe(false);
  });
});
