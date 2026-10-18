import type { Metadata } from 'next';
import Link from 'next/link';
import { getGameIndex, type GameIndexEntry } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Все игры от А до Я',
  description: 'Все игры GameMarket по алфавиту: аккаунты, валюта, предметы, ключи и пополнения.',
  alternates: { canonical: '/igry' },
};

/** Первая буква для группы: латиница и кириллица — как есть, цифры и прочее — «0–9». */
const letterOf = (title: string) => {
  const ch = title.trim().charAt(0).toUpperCase();
  return /[A-ZА-ЯЁ]/.test(ch) ? (ch === 'Ё' ? 'Е' : ch) : '0–9';
};

/**
 * Указатель игр А–Я — как список игр на главной FunPay: каждая игра с
 * разделами и числом лотов, буквы сверху для быстрого перехода.
 */
export default async function GamesIndexPage() {
  const games = (await getGameIndex()) ?? [];
  const groups = new Map<string, GameIndexEntry[]>();
  for (const g of [...games].sort((a, b) => a.title.localeCompare(b.title, 'ru'))) {
    const l = letterOf(g.title);
    groups.set(l, [...(groups.get(l) ?? []), g]);
  }
  // Цифры, затем латиница, затем кириллица.
  const order = (l: string) => (l === '0–9' ? 0 : /[A-Z]/.test(l) ? 1 : 2);
  const letters = [...groups.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b, 'ru'));

  return (
    <div className="container stack-lg" style={{ paddingTop: 48 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 34 }}>Все игры</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>{games.length} игр — от А до Я, с разделами и числом лотов.</p>
      </div>

      {letters.length > 1 && (
        <nav aria-label="Буквы" className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {letters.map((l) => (
            <a key={l} href={`#letter-${l}`} className="chip" style={{ minWidth: 40, justifyContent: 'center' }}>
              {l}
            </a>
          ))}
        </nav>
      )}

      {games.length === 0 ? (
        <p className="muted">Игр пока нет.</p>
      ) : (
        <div className="stack-lg">
          {letters.map((l) => (
            <section key={l} id={`letter-${l}`} style={{ scrollMarginTop: 80 }}>
              <h2 className="h2" style={{ fontSize: 22, marginBottom: 12 }}>{l}</h2>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                {groups.get(l)!.map((g) => (
                  <div key={g.id} className="card" style={{ padding: 16 }}>
                    <Link href={`/igra/${g.slug}`} style={{ fontWeight: 700, fontSize: 16 }}>{g.title}</Link>
                    {g.categories.length > 0 && (
                      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 4 }}>
                        {g.categories.map((c) => (
                          <li key={c.id} className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
                            <Link href={`/igra/${g.slug}/${c.slug}`} className="muted">{c.title}</Link>
                            <span className="faint">{c.listingCount}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
