const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Тонкий клиент к API. На сервере (RSC) и клиенте используется одинаково. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}
