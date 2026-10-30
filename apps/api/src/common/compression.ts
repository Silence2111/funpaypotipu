import compression from 'compression';
import type { Request, Response } from 'express';

/**
 * Сжатие ответов API — brotli или gzip, что примет браузер. Без него
 * «Мои лоты» продавца с 5 тыс. лотов уходили 2,6 МБ JSON.
 *
 * Не сжимаются: ответы меньше 1 КБ (выигрыша нет), уже сжатые файлы — фото,
 * видео, PDF (по типу, как решает `compression`), и всё под `/api/auth`.
 * Там единственные запросы, которые браузер подписывает сам — cookie
 * обновления входа, — и в ответах токены: сжатие рядом с введённым текстом
 * выдаёт секрет по длине ответа (BREACH). Остальное API требует заголовок
 * Authorization, его чужой сайт за посетителя не подставит.
 */
export const apiCompression = compression({
  threshold: 1024,
  filter: (req: Request, res: Response) =>
    !/^\/api\/auth(\/|\?|$)/.test(req.originalUrl ?? req.url) && compression.filter(req, res),
});
