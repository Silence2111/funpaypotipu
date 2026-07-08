import type { Metadata } from 'next';
import Link from 'next/link';
import { browseListings, getGames, getGame, getCategoryAttributes, type Attribute } from '@/lib/api';
import { ListingCardView } from '@/components/cards';
import { SearchBar } from '@/components/search-bar';

export const metadata: Metadata = {
  title: 'Каталог — поиск игровых товаров',
  description: 'Поиск и фильтр лотов: аккаунты, валюта, предметы, ключи, пополнения.',
};

type SP = Record<string, string | undefined>;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const sort = sp.sort ?? 'new';

  // Значения фасетов приходят как f_<key>=value.
  const facets: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (k.startsWith('f_') && v) facets[k.slice(2)] = v;
  }
  const attrsParam = Object.keys(facets).length ? JSON.stringify(facets) : undefined;

  const [games, browse] = await Promise.all([
    getGames(),
    browseListings({
      q: sp.q, gameSlug: sp.game, categorySlug: sp.category, sort, attrs: attrsParam, limit: 24, page,
    }),
  ]);

  // Категории выбранной игры + атрибуты выбранной категории (для фасетов).
  const game = sp.game ? await getGame(sp.game) : null;
  const categories = game?.categories ?? [];
  const selectedCat = categories.find((c) => c.slug === sp.category);
  let attributes: Attribute[] = [];
  if (selectedCat) {
    attributes = (await getCategoryAttributes(selectedCat.id))?.filter((a) => a.isFilter && a.type === 'enum') ?? [];
  }

  const items = browse?.items ?? [];
  const total = browse?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 24));

  // Сборка URL: базовые параметры + фасеты + патч (undefined убирает ключ).
  const qs = (patch: SP) => {
    const base: SP = { q: sp.q, game: sp.game, category: sp.category, sort, page: String(page) };
    for (const [k, v] of Object.entries(facets)) base[`f_${k}`] = v;
    const merged = { ...base, ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    return `/catalog?${p}`;
  };

  const chip = (active: boolean) =>
    active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined;

  return (
    <div className="container stack-lg" style={{ paddingTop: 48 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 30, marginBottom: 16 }}>Каталог</h1>
        <SearchBar initial={sp.q ?? ''} game={sp.game} />
      </div>

      {/* Игры */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Link href={qs({ game: undefined, category: undefined, page: '1' })} className="chip" style={chip(!sp.game)}>
          Все игры
        </Link>
        {(games ?? []).map((g) => (
          <Link key={g.id} href={qs({ game: g.slug, category: undefined, page: '1' })} className="chip"
            style={chip(sp.game === g.slug)}>
            {g.title}
          </Link>
        ))}
        <span className="spacer" />
        {[['new', 'новые'], ['popular', 'популярные'], ['price_asc', 'дешевле'], ['price_desc', 'дороже']].map(([v, label]) => (
          <Link key={v} href={qs({ sort: v, page: '1' })} className="chip" style={chip(sort === v)}>
            {label}
          </Link>
        ))}
      </div>

      {/* Категории выбранной игры */}
      {categories.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {categories.map((c) => (
            <Link key={c.id} href={qs({ category: c.slug, page: '1' })} className="chip"
              style={{ ...chip(sp.category === c.slug), fontSize: 13 }}>
              {c.title}
              {typeof c.listingCount === 'number' && (
                <span className="faint" style={{ marginLeft: 4 }}>{c.listingCount}</span>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Фасеты по атрибутам выбранной категории */}
      {attributes.length > 0 && (
        <div className="grid" style={{ gap: 12 }}>
          {attributes.map((a) => (
            <div key={a.key}>
              <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>{a.label}</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {(a.options ?? []).map((opt) => {
                  const on = facets[a.key] === opt;
                  return (
                    <Link key={opt} href={qs({ [`f_${a.key}`]: on ? undefined : opt, page: '1' })}
                      className="chip" style={{ ...chip(on), fontSize: 13 }}>
                      {opt}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="faint" style={{ fontSize: 13, marginBottom: 16 }}>Найдено: {total}</p>
        {items.length ? (
          <div className="grid cols-auto">
            {items.map((l) => <ListingCardView key={l.id} listing={l} />)}
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
