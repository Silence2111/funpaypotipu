/**
 * Знаки игр и сервисов для плиток (главная, карточки лотов). Глифы — Simple Icons (CC0, simpleicons.org),
 * лежат в public/igry/<slug>.svg и рисуются CSS-маской: цвет знака — фирменный, плитка — его бледный оттенок
 * (лёгкий вид, выбор владельца 18.11.2026). У чёрных и серых марок (Steam, CS2, Roblox…) color = null:
 * знак цветом текста темы, чтобы в тёмной теме не пропадал. Только точные знаки: игры без своего знака
 * в наборе (Genshin, Minecraft, Standoff 2…) показываются буквенной плиткой, не чужим логотипом.
 * Без персонажей и ключевых артов — только эмблемы (правило владельца: без людей и животных на картинках).
 */
export const GAME_ICONS: Record<string, { color: string | null }> = {
  'cs2': { color: null },
  'dota2': { color: "#bf2e1a" },
  'steam': { color: null },
  'roblox': { color: null },
  'telegram': { color: "#229ed9" },
  'fortnite': { color: null },
  'valorant': { color: "#fa4454" },
  'gta5': { color: "#b07a10" },
  'pubg-mobile': { color: "#aa812e" },
  'pubg': { color: "#aa812e" },
  'discord': { color: "#5865f2" },
  'apple': { color: null },
  'battlenet': { color: "#4381c3" },
  'ea': { color: null },
  'epic': { color: null },
  'faceit': { color: "#ff5500" },
  'google-play': { color: null },
  'lol': { color: "#b8862a" },
  'playstation': { color: "#0070d1" },
  'spotify': { color: "#159643" },
  'tiktok': { color: null },
  'ubisoft': { color: null },
  'youtube': { color: "#ff0000" },
};

export const gameIcon = (slug: string) =>
  GAME_ICONS[slug] ? { src: `/igry/${slug}.svg`, color: GAME_ICONS[slug].color } : null;
