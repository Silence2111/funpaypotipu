import { Fragment } from 'react';
import Link from 'next/link';
import type { GameIndexEntry } from '@/lib/api';
import { GameTile } from './cards';
import { offersCount } from '@/lib/format';

/** Буква указателя: латиница и кириллица отдельно, цифры и знаки — «#». */
function letterOf(title: string): string {
  const ch = title.trim().charAt(0).toUpperCase();
  if (/[A-Z]/.test(ch)) return ch;
  if (/[А-ЯЁ]/.test(ch)) return ch === 'Ё' ? 'Е' : ch;
  return '#';
}

const groupRank = (l: string) => (l === '#' ? 0 : /[A-Z]/.test(l) ? 1 : 2);

export function groupByLetter(games: GameIndexEntry[]) {
  const map = new Map<string, GameIndexEntry[]>();
  for (const g of games) {
    const l = letterOf(g.title);
    map.set(l, [...(map.get(l) ?? []), g]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b, 'ru'))
    .map(([letter, list]) => ({ letter, games: list.sort((a, b) => a.title.localeCompare(b.title, 'ru')) }));
}

/**
 * Указатель игр от А до Я, как главная FunPay: у каждой игры — ссылки на её
 * разделы. Разделы без предложений тише, но тоже ссылки: из пустого раздела
 * зовём продать первым.
 */
export function GameDirectory({ games }: { games: GameIndexEntry[] }) {
  const groups = groupByLetter(games);
  return (
    <div className="directory">
      <nav className="letters" aria-label="Буквы указателя">
        {groups.map((g) => (
          <a key={g.letter} href={`#l-${g.letter}`}>
            {g.letter}
          </a>
        ))}
      </nav>
      {groups.map((grp) => (
        <section key={grp.letter} id={`l-${grp.letter}`} className="dir-group" aria-label={`На букву ${grp.letter}`}>
          <div className="dir-letter" aria-hidden>
            {grp.letter}
          </div>
          <div className="dir-games">
            {grp.games.map((g) => (
              <div key={g.id} className="dir-game">
                <Link href={`/igra/${g.slug}`} className="dir-title">
                  {g.title}
                </Link>
                <div className="dir-sections">
                  {g.categories.map((c, i) => (
                    <Fragment key={c.id}>
                      {i > 0 && <span aria-hidden> · </span>}
                      <Link href={`/igra/${g.slug}/${c.slug}`} data-empty={c.listingCount ? undefined : 'true'}>
                        {c.title}
                      </Link>
                    </Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** «Популярные»: плитки игр с числом предложений, а без них — с разделами. */
export function PopularGames({ games, limit = 12 }: { games: GameIndexEntry[]; limit?: number }) {
  const top = games
    .filter((g) => g.sortOrder < 100)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, limit);
  return (
    <div className="popular">
      {top.map((g) => {
        const offers = g.categories.reduce((n, c) => n + c.listingCount, 0);
        return (
          <Link key={g.id} href={`/igra/${g.slug}`} className="popular-game">
            <span className="popular-icon">
              <GameTile title={g.title} size={16} />
            </span>
            <span className="popular-text">
              <span className="popular-title">{g.title}</span>
              <span className="popular-sub">
                {offers > 0
                  ? offersCount(offers)
                  : g.categories
                      .slice(0, 3)
                      .map((c) => c.title)
                      .join(', ')}
              </span>
              {g.onlineSellers ? (
                <span className="popular-online">
                  <span className="dot-online" aria-hidden /> {g.onlineSellers} в сети
                </span>
              ) : null}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
