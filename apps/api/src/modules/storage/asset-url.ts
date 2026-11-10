const ASSET_BASE = process.env.PUBLIC_ASSET_BASE ?? '';

/** Ключ в хранилище → публичный адрес через /api/assets; готовые http-ссылки — как есть. */
export const assetUrl = (key: string | null | undefined): string | null =>
  !key ? null : /^https?:\/\//.test(key) ? key : `${ASSET_BASE}/api/assets?key=${encodeURIComponent(key)}`;
