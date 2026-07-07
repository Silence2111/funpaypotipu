import type { Metadata } from 'next';
import Link from 'next/link';
import { browseListings, getGames } from '@/lib/api';
import { ListingCardView } from '@/components/cards';
import { SearchBar } from '@/components/search-bar';

export const metadata: Metadata = {
  title: 'Каталог — поиск игровых товаров',
  description: 'Поиск и фильтр лотов: аккаунты, валюта, предметы, ключи, пополнения.',
};

type SP = { q?: string; game?: string; sort?: string; page?: string };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const sort = sp.sort ?? 'new';

  const [games, browse] = await Promise.all([
    getGames(),
    browseListings({ q: sp.q, gameSlug: sp.game, sort, limit: 24, page }),
  ]);
  const items = browse?.items ?? [];
  const total = browse?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 24));

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, game: sp.game, sort, page: String(page), ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    return `/catalog?${p}`;
  };

  return (
    <div className="container stack-lg" style={{ paddingTop: 48 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 30, marginBottom: 16 }}>Каталог</h1>
        <SearchBar initial={sp.q ?? ''} game={sp.game} />
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Link href={qs({ game: undefined, page: '1' })} className="chip"
          style={!sp.game ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
          Все игры
        </Link>
        {(games ?? []).map((g) => (
          <Link key={g.id} href={qs({ game: g.slug, page: '1' })} className="chip"
            style={sp.game === g.slug ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
            {g.title}
          </Link>
        ))}
        <span className="spacer" />
        {[['new', 'новые'], ['price_asc', 'дешевле'], ['price_desc', 'дороже']].map(([v, label]) => (
          <Link key={v} href={qs({ sort: v, page: '1' })} className="chip"
            style={sort === v ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
            {label}
          </Link>
        ))}
      </div>

      <div>
        <p className="faint" style={{ fontSize: 13, marginBottom: 16 }}>Найдено: {total}</p>
        {items.length ? (
          <div className="grid cols-auto">
            {items.map((l) => (
              <ListingCardView key={l.id} listing={l} />
            ))}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p className="muted" style={{ margin: 0 }}>Ничего не найдено.</p>
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          {page > 1 && <Link href={qs({ page: String(page - 1) })} className="chip">← Назад</Link>}
          <span className="faint" style={{ fontSize: 14, alignSelf: 'center' }}>{page} / {pages}</span>
          {page < pages && <Link href={qs({ page: String(page + 1) })} className="chip">Вперёд →</Link>}
        </div>
      )}
    </div>
  );
}
