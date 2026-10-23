import { apiResponse } from './session';

/**
 * Скачать файл из API с входом: обычная ссылка не передаст токен, поэтому
 * файл забирается запросом и отдаётся браузеру. Имя — из ответа сервера.
 */
export async function downloadFile(path: string): Promise<void> {
  const res = await apiResponse(path);
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
    'gamemarket.csv';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
