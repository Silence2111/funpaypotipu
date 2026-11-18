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
 * Знаки игр, которых нет в Simple Icons (19.11.2026, «доделай всё»; правило владельца — «компаниям ставь их лого»):
 * значки с официальных сайтов игр, `public/igry/logo/<slug>.webp`. Отобраны вручную: только знак игры — без
 * персонажей, людей и животных (Genshin, Raid, Tarkov, Black Russia и др. остались буквенными), без знака
 * издателя вместо игры (EA, Supercell, Activision). full — значок уже на своей плитке, иначе знак кладём на bg.
 * px — родной размер: мелкий знак (32–64 px) не растягиваем на всю плитку, чтобы не мылился. cover — цвет обложек.
 */
export const GAME_LOGOS: Record<string, { bg: string; full?: boolean; px: number; cover: string; light?: boolean }> = {
  'albion': { bg: '#e7f1f3', full: true, px: 144, cover: '#e0782f' },
  'archeage': { bg: '#ffffff', full: true, px: 152, cover: '#2f8f4e' },
  'arizona': { bg: '#ffffff', px: 176, cover: '#e2345f' },
  'bdo': { bg: '#785e43', full: true, px: 192, cover: '#8a6a45' },
  'dbd': { bg: '#000000', full: true, px: 192, cover: '#b3261e' },
  'ff14': { bg: '#1a1a1a', full: true, px: 144, cover: '#b92c2c' },
  'gta5rp': { bg: '#ffffff', px: 179, cover: '#f59e0b', light: true },
  'lineage2': { bg: '#c83124', full: true, px: 128, cover: '#b8322a' },
  'lost-ark': { bg: '#15171c', px: 190, cover: '#a8782a' },
  'mlbb': { bg: '#ffffff', full: true, px: 120, cover: '#ef8a1c' },
  'nintendo': { bg: '#e60012', full: true, px: 180, cover: '#e60012' },
  'perfect-world': { bg: '#ffc104', full: true, px: 152, cover: '#f5b300', light: true },
  'pokemon-go': { bg: '#2f6fd6', full: true, px: 48, cover: '#2f6fd6' },
  'r6': { bg: '#ffffff', px: 124, cover: '#33475b' },
  'radmir': { bg: '#ffffff', full: true, px: 39, cover: '#f26b1d' },
  'rust': { bg: '#cd412b', full: true, px: 180, cover: '#cd412b' },
  'standoff2': { bg: '#ffffff', px: 192, cover: '#c8372c' },
  'tl': { bg: '#15171c', px: 192, cover: '#8c6d3f' },
  'war-thunder': { bg: '#ffffff', full: true, px: 180, cover: '#c8352b' },
  'warframe': { bg: '#ffffff', full: true, px: 192, cover: '#1f8ea3' },
  'wild-rift': { bg: '#0d1b2e', px: 128, cover: '#1a9ee6' },
  'wot': { bg: '#1d1f22', px: 192, cover: '#5f6f33' },
  'wows': { bg: '#ffffff', px: 155, cover: '#2d5fa8' },
  'xbox': { bg: '#ffffff', px: 192, cover: '#107c10' },
  'wow': { bg: '#15171c', px: 32, cover: '#a8782a' },
  'wow-classic': { bg: '#15171c', px: 32, cover: '#a8782a' },
  'hearthstone': { bg: '#1b2a4a', px: 64, cover: '#2a5ab0' },
  'diablo4': { bg: '#140707', full: true, px: 32, cover: '#8c1c13' },
  'overwatch2': { bg: '#ffffff', px: 31, cover: '#f08a12' },
  'free-fire': { bg: '#15171c', px: 42, cover: '#f2a900', light: true },
  'mir-tankov': { bg: '#ffffff', px: 164, cover: '#e8492b' },
};

export const gameLogo = (slug: string) =>
  GAME_LOGOS[slug] ? { src: `/igry/logo/${slug}.webp`, ...GAME_LOGOS[slug] } : null;

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
  return COVER[slug] ?? GAME_ICONS[slug]?.bg ?? GAME_LOGOS[slug]?.cover ?? monogramColor(title);
}

/** Светлая ли обложка (жёлтые PUBG и GTA, зелёный Spotify): тогда текст на ней тёмный. */
export const coverIsLight = (slug: string) => (!COVER[slug] && GAME_ICONS[slug]?.glyph === '#15171c') || !!GAME_LOGOS[slug]?.light;

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
