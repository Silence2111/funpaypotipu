import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { browseListings, getGameIndex, getCategoryAttributes, SEGMENTS, type Attribute } from '@/lib/api';
import { OfferTable } from '@/components/offers';
import { SearchBar } from '@/components/search-bar';
import { ParamSelect } from '@/components/param-select';

export const metadata: Metadata = {
  title: 'Все предложения — поиск игровых товаров',
  description: 'Поиск по предложениям продавцов: аккаунты, валюта, предметы, ключи, донат и услуги во всех играх.',
};

type SP = Record<string, string | undefined>;
const PAGE_SIZE = 30;

/**
 * Поиск по предложениям во всех играх: по словам, по типу товара («все
 * аккаунты»), по игре. Раздел конкретной игры живёт на своей странице —
 * туда и ведёт выбор игры с разделом без поискового запроса.
 */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (sp.game && sp.category && !sp.q) {
    const rest = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && (k.startsWith('f_') || k === 'online' || k === 'sort')) rest.set(k, v);
    const s = rest.toString();
    redirect(`/igra/${encodeURIComponent(sp.game)}/${encodeURIComponent(sp.category)}${s ? `?${s}` : ''}`);
  }

  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const sort = ['price_asc', 'price_desc', 'popular'].includes(sp.sort ?? '') ? sp.sort! : 'new';
  const segment = SEGMENTS.find(([k]) => k === sp.segment);

  // Значения фасетов приходят как f_<key>=value.
  const facets: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (k.startsWith('f_') && v) facets[k.slice(2)] = v;
  }

  const [index, browse] = await Promise.all([
    getGameIndex(),
    browseListings({
      q: sp.q,
      gameSlug: sp.game,
      categorySlug: sp.category,
      segment: segment?.[0],
      sort,
      attrs: Object.keys(facets).length ? JSON.stringify(facets) : undefined,
      limit: PAGE_SIZE,
      page,
      online: sp.online === '1',
    }),
  ]);
  const games = index ?? [];
  const game = sp.game ? games.find((g) => g.slug === sp.game) : undefined;
  const selectedCat = game?.categories.find((c) => c.slug === sp.category);
  let columns: Attribute[] = [];
  if (selectedCat) columns = (await getCategoryAttributes(selectedCat.id)) ?? [];

  const items = browse?.items ?? [];
  const total = browse?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Сборка URL: текущие параметры + патч (undefined убирает ключ).
  const qs = (patch: SP) => {
    const merged: SP = { ...sp, page: undefined, ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/catalog?${s}` : '/catalog';
  };

  const title = segment
    ? `${segment[1]} во всех играх`
    : game
      ? `${game.title}: поиск`
      : sp.q
        ? `Поиск: «${sp.q}»`
        : 'Все предложения';

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <h1 className="h1" style={{ fontSize: 34 }}>
        {title}
      </h1>
      <div style={{ marginTop: 20 }}>
        <SearchBar initial={sp.q ?? ''} game={sp.game} />
      </div>

      <nav className="type-chips" aria-label="Тип товара" style={{ marginTop: 20 }}>
        <Link href={qs({ segment: undefined })} className="chip" aria-current={!segment ? 'page' : undefined}>
          Все типы
        </Link>
        {SEGMENTS.map(([key, label]) => (
          <Link key={key} href={qs({ segment: key })} className="chip" aria-current={segment?.[0] === key ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>

      <div className="filters" style={{ marginTop: 16 }}>
        <div className="filters-group">
          <ParamSelect
            name="game"
            label="Игра"
            value={game?.slug}
            options={[...games].sort((a, b) => a.title.localeCompare(b.title, 'ru')).map((g) => [g.slug, g.title])}
            reset={['category']}
          />
          <Link
            href={qs({ online: sp.online === '1' ? undefined : '1' })}
            className="chip"
            aria-pressed={sp.online === '1'}
          >
            <span className="dot-online" aria-hidden />
            Продавец в сети
          </Link>
        </div>
        <div className="filters-group filters-side">
          {[
            ['new', 'Сначала поднятые'],
            ['price_asc', 'Дешевле'],
            ['price_desc', 'Дороже'],
            ['popular', 'Часто покупают'],
          ].map(([v, label]) => (
            <Link
              key={v}
              href={qs({ sort: v === 'new' ? undefined : v })}
              className="chip"
              aria-current={sort === v ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {game && game.categories.length > 0 && (
        <nav className="tabs" aria-label={`Разделы: ${game.title}`} style={{ marginTop: 20 }}>
          {game.categories.map((c) => (
            <Link key={c.id} href={`/igra/${game.slug}/${c.slug}`} className="tab">
              {c.title}
              <span className="count">{c.listingCount}</span>
            </Link>
          ))}
        </nav>
      )}

      <p className="faint" style={{ fontSize: 13, margin: '20px 0 12px' }}>
        Найдено: {total}
      </p>
      {items.length ? (
        // Без выбранного раздела в выдаче смешаны разделы: пишем их в строке.
        <OfferTable items={items} attributes={columns} showSection={!selectedCat} />
      ) : (
        <div className="card flat empty-state">
          <p className="muted">Ничего не нашлось. Попробуйте другие слова или уберите фильтры.</p>
          <Link href="/catalog" className="btn secondary">
            Сбросить
          </Link>
        </div>
      )}

      {pages > 1 && (
        <nav className="row" aria-label="Страницы" style={{ justifyContent: 'center', gap: 8, marginTop: 24 }}>
          {page > 1 && (
            <Link href={qs({ page: String(page - 1) })} className="chip">
              ← Назад
            </Link>
          )}
          <span className="faint" style={{ fontSize: 14 }}>
            {page} из {pages}
          </span>
          {page < pages && (
            <Link href={qs({ page: String(page + 1) })} className="chip">
              Дальше →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
