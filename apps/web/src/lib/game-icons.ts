/**
 * Знаки игр и сервисов — как настоящие значки приложений: фирменный цвет плитки и знак белым
 * (на светлых марках — тёмным). Глифы — Simple Icons (CC0, simpleicons.org), public/igry/<slug>.svg,
 * рисуются CSS-маской. Владелец 18.11: бледные плитки со значком — «слоп», нужен полноцветный вид.
 * Только точные знаки: игры без своего знака в наборе (Genshin, Minecraft, Standoff 2…) — буквенная
 * плитка своего цвета, не чужой логотип. Без персонажей и ключевых артов (правило владельца).
 */
export const GAME_ICONS: Record<string, { bg: string; glyph: string }> = {
  'cs2': { bg: '#1b1f24', glyph: '#ffffff' },
  'dota2': { bg: '#bf2e1a', glyph: '#ffffff' },
  'steam': { bg: '#171a21', glyph: '#ffffff' },
  'roblox': { bg: '#15171c', glyph: '#ffffff' },
  'telegram': { bg: '#26a5e4', glyph: '#ffffff' },
  'fortnite': { bg: '#15171c', glyph: '#ffffff' },
  'valorant': { bg: '#fa4454', glyph: '#ffffff' },
  'gta5': { bg: '#fcaf17', glyph: '#15171c' },
  'pubg-mobile': { bg: '#f4b942', glyph: '#15171c' },
  'pubg': { bg: '#f4b942', glyph: '#15171c' },
  'discord': { bg: '#5865f2', glyph: '#ffffff' },
  'apple': { bg: '#15171c', glyph: '#ffffff' },
  'battlenet': { bg: '#4381c3', glyph: '#ffffff' },
  'ea': { bg: '#15171c', glyph: '#ffffff' },
  'epic': { bg: '#313131', glyph: '#ffffff' },
  'faceit': { bg: '#ff5500', glyph: '#ffffff' },
  'google-play': { bg: '#414141', glyph: '#ffffff' },
  'lol': { bg: '#c28f2c', glyph: '#ffffff' },
  'playstation': { bg: '#0070d1', glyph: '#ffffff' },
  'spotify': { bg: '#1ed760', glyph: '#15171c' },
  'tiktok': { bg: '#15171c', glyph: '#ffffff' },
  'ubisoft': { bg: '#15171c', glyph: '#ffffff' },
  'youtube': { bg: '#ff0000', glyph: '#ffffff' },
};

export const gameIcon = (slug: string) =>
  GAME_ICONS[slug] ? { src: `/igry/${slug}.svg`, ...GAME_ICONS[slug] } : null;

/**
 * Цвет обложки лота и баннера (18.11.2026, по образцу Playerok: витрина яркая). У марок с почти чёрной
 * плиткой (Steam, CS2, Roblox, Fortnite…) обложка цветом плитки выходила серой — берём второй цвет
 * из их же фирменной гаммы. У остальных — цвет плитки.
 */
const COVER: Record<string, string> = {
  'cs2': '#de9b35', 'steam': '#1a9fff', 'roblox': '#3b6cff', 'fortnite': '#9d4dbb', 'apple': '#0071e3',
  'ea': '#ff4747', 'epic': '#0078f2', 'google-play': '#01875f', 'tiktok': '#fe2c55', 'ubisoft': '#0070ff',
};

export function coverColor(slug: string, title: string): string {
  return COVER[slug] ?? GAME_ICONS[slug]?.bg ?? monogramColor(title);
}

/** Светлая ли обложка (жёлтые PUBG и GTA, зелёный Spotify): тогда текст на ней тёмный. */
export const coverIsLight = (slug: string) => !COVER[slug] && GAME_ICONS[slug]?.glyph === '#15171c';

/** Цвет буквенной плитки для игры без знака: постоянный по названию, насыщенный, под белые буквы. */
export function monogramColor(title: string): string {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 52% 42%)`;
}

/** Две буквы для плитки без знака: «Genshin Impact» → GI, «Minecraft» → MI. */
export function monogram(title: string): string {
  const words = title.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}
