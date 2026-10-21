import { getToken } from './session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Фото с телефона весит 4–8 МБ и 4000 px по стороне: уменьшаем до 1600 px
 * перед загрузкой — быстрее по мобильной сети и проходит лимит сервера.
 * Не получилось уменьшить или вышло не меньше — уходит оригинал.
 */
export async function shrink(file: File): Promise<Blob> {
  if (
    !/^image\/(jpeg|png|webp)$/.test(file.type) ||
    file.size < 1_500_000 ||
    typeof createImageBitmap !== 'function'
  ) {
    return file;
  }
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', 0.86));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/**
 * Загрузить фото в API (multipart, поле file): уменьшенное, с входом и
 * языком сайта для текста отказа. Отказ — исключением с ответом сервера.
 */
export async function uploadPhoto(
  path: string,
  file: File,
  lang: string,
): Promise<{ key: string; blob: Blob }> {
  const blob = await shrink(file);
  const fd = new FormData();
  fd.append('file', blob, blob === file ? file.name : 'photo.webp');
  const token = getToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    headers: { 'Accept-Language': lang, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: fd,
  });
  if (!res.ok) throw new Error(await res.text());
  const { key } = (await res.json()) as { key: string };
  return { key, blob };
}
