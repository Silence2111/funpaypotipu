import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiCompression } from '../src/common/compression';

/**
 * Сжатие ответов API: большой JSON — сжат, мелкий — нет; фото — нет (уже
 * сжато); ответы входа (`/api/auth`) — никогда: в них токены, а браузер
 * подписывает эти запросы cookie сам (BREACH).
 */

const big = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, title: `Лот ${i}` })));
let base = '';
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  apiCompression(req as never, res as never, () => {
    const url = req.url ?? '';
    if (url.startsWith('/api/small')) {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    } else if (url.startsWith('/api/photo')) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.end(Buffer.alloc(4096, 1));
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(big);
    }
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function get(path: string, encoding = 'gzip') {
  return new Promise<{ encoding?: string; vary?: string; body: Buffer }>((resolve, reject) => {
    request(`${base}${path}`, { headers: { 'Accept-Encoding': encoding } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          encoding: res.headers['content-encoding'],
          vary: res.headers.vary as string | undefined,
          body: Buffer.concat(chunks),
        }),
      );
    })
      .on('error', reject)
      .end();
  });
}

describe('сжатие ответов API', () => {
  it('большой JSON — gzip, распаковывается в тот же ответ; Vary по Accept-Encoding', async () => {
    const r = await get('/api/listings/mine');
    expect(r.encoding).toBe('gzip');
    expect(r.vary).toMatch(/Accept-Encoding/i);
    expect(gunzipSync(r.body).toString()).toBe(big);
    expect(r.body.length).toBeLessThan(big.length / 3);
  });

  it('браузер принимает brotli — brotli; не принимает ничего — как есть', async () => {
    expect((await get('/api/listings/mine', 'br, gzip')).encoding).toBe('br');
    const plain = await get('/api/listings/mine', 'identity');
    expect(plain.encoding).toBeUndefined();
    expect(plain.body.toString()).toBe(big);
  });

  it('вход, мелкие ответы и фото — без сжатия', async () => {
    for (const path of ['/api/auth/refresh', '/api/auth', '/api/auth?x=1']) {
      const r = await get(path);
      expect(r.encoding, path).toBeUndefined();
      expect(r.body.toString(), path).toBe(big);
    }
    // «/api/authors» — не вход: сжимается как всё остальное.
    expect((await get('/api/authors')).encoding).toBe('gzip');
    expect((await get('/api/small')).encoding).toBeUndefined();
    expect((await get('/api/photo')).encoding).toBeUndefined();
  });
});
