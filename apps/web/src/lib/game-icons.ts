/**
 * Знаки игр и сервисов для плиток (главная, карточки лотов). Глифы — Simple Icons (CC0, simpleicons.org),
 * белые или тёмные на фирменном цвете, лежат в public/igry/<slug>.svg. Только точные знаки: игры без своего
 * знака в наборе (Genshin, Minecraft, Standoff 2…) показываются буквенной плиткой, не чужим логотипом.
 * Без персонажей и ключевых артов — только эмблемы (правило владельца: без людей и животных на картинках).
 */
export const GAME_ICONS: Record<string, { bg: string }> = {
  "cs2": {
    bg: "#1B1F24"
  },
  "dota2": {
    bg: "#BF2E1A"
  },
  "steam": {
    bg: "#171A21"
  },
  "roblox": {
    bg: "#15171C"
  },
  "telegram": {
    bg: "#26A5E4"
  },
  "fortnite": {
    bg: "#15171C"
  },
  "valorant": {
    bg: "#FA4454"
  },
  "gta5": {
    bg: "#FCAF17"
  },
  "pubg-mobile": {
    bg: "#F4B942"
  },
  "pubg": {
    bg: "#F4B942"
  },
  "discord": {
    bg: "#5865F2"
  },
  "apple": {
    bg: "#15171C"
  },
  "battlenet": {
    bg: "#4381C3"
  },
  "ea": {
    bg: "#15171C"
  },
  "epic": {
    bg: "#313131"
  },
  "faceit": {
    bg: "#FF5500"
  },
  "google-play": {
    bg: "#414141"
  },
  "lol": {
    bg: "#C28F2C"
  },
  "playstation": {
    bg: "#0070D1"
  },
  "spotify": {
    bg: "#1ED760"
  },
  "tiktok": {
    bg: "#15171C"
  },
  "ubisoft": {
    bg: "#15171C"
  },
  "youtube": {
    bg: "#FF0000"
  },
};

export const gameIcon = (slug: string) => (GAME_ICONS[slug] ? { src: `/igry/${slug}.svg`, bg: GAME_ICONS[slug].bg } : null);
