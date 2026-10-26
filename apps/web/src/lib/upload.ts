'use client';

import { apiFetch } from './session';
import { documentLang } from './i18n/lang';

/** Метаданные загруженного файла — форма, которую ожидают attachments API. */
export interface UploadedAttachment {
  key: string;
  mime: string;
  size: number;
}

/**
 * Presigned-загрузка файла: POST `<path>` c mime → PUT файла по выданному uploadUrl.
 * Используется чатом заказа и спорами (единый флоу, разные эндпоинты).
 */
export async function uploadViaPresignedUrl(
  path: string,
  file: File,
  // Без входа — чем подтверждено право загружать: токен из ссылки в письме.
  extra: Record<string, string> = {},
): Promise<UploadedAttachment> {
  const mime = file.type || 'application/octet-stream';
  const up = await apiFetch<{ key: string; uploadUrl: string }>(path, {
    method: 'POST',
    body: JSON.stringify({ ...extra, mime }),
  });
  // Не загрузилось — не создаём сообщение со ссылкой на пустоту.
  const res = await fetch(up.uploadUrl, {
    method: 'PUT',
    body: file,
    // Ошибка хранилища на API — на языке сайта.
    headers: { 'Content-Type': mime, 'Accept-Language': documentLang() },
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
  return { key: up.key, mime, size: file.size };
}
