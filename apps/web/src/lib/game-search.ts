import type { GameIndexEntry } from './api';

/** Нижний регистр, «ё» как «е», без знаков: «Counter-Strike 2» → «counter strike 2». */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е') // i18n-ignore
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface GameHit {
  game: GameIndexEntry;
  /** Раздел, если запрос его назвал: «золото вов» → World of Warcraft, «Золото». */
  section?: GameIndexEntry['categories'][number];
}

/** Насколько название или синоним похожи на запрос: 0 — не похожи. */
function score(game: GameIndexEntry, q: string): number {
  const names = [norm(game.title), ...game.aliases.map(norm)];
  if (names.includes(q)) return 100;
  if (names.some((n) => n.startsWith(q))) return 80;
  if (names.some((n) => n.split(' ').some((w) => w.startsWith(q)))) return 60;
  if (q.length >= 3 && names.some((n) => n.includes(q))) return 40;
  return 0;
}

/**
 * Поиск по играм, как «Поиск по 885 играм» у FunPay: по названию и по тому,
 * как игру называют игроки («кс», «вов»). Если одно из слов — раздел игры,
 * подсказка ведёт сразу в него: «аккаунт кс» → CS2, «Аккаунты».
 */
export function searchGames(index: GameIndexEntry[], query: string, limit = 8): GameHit[] {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(' ');
  const hits: Array<GameHit & { score: number }> = [];

  for (const game of index) {
    const whole = score(game, q);
    if (whole > 0) {
      hits.push({ game, score: whole });
      continue;
    }
    if (words.length < 2) continue;
    // Одно слово — раздел, остальные — игра.
    for (const [i, w] of words.entries()) {
      if (w.length < 3) continue;
      const section = game.categories.find((c) => norm(c.title).split(' ').some((t) => t.startsWith(w)));
      if (!section) continue;
      const rest = words.filter((_, j) => j !== i).join(' ');
      const s = score(game, rest);
      if (s > 0) {
        hits.push({ game, section, score: s - 1 });
        break;
      }
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || a.game.sortOrder - b.game.sortOrder || a.game.title.localeCompare(b.game.title))
    .slice(0, limit)
    .map(({ game, section }) => ({ game, section }));
}

/** Ссылка на игру или сразу на найденный раздел. */
export const hitHref = (h: GameHit) => (h.section ? `/igra/${h.game.slug}/${h.section.slug}` : `/igra/${h.game.slug}`);
