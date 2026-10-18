import Link from 'next/link';
import { browseListings, getCategoryAttributes, type Category, type GameWithCategories } from '@/lib/api';
import { offersCount } from '@/lib/format';
import { OfferTable } from './offers';
import { SectionFilters } from './section-filters';

/** Параметры адреса раздела: f_<ключ>, online, q, sort, page. */
export type SectionSearch = Record<string, string | undefined>;

const PAGE_SIZE = 50;
const SORTS = ['new', 'price_asc', 'price_desc', 'popular'];

/** Раздел для /igra/<игра>: первый с предложениями, а если пусто везде — первый. */
export function defaultSection(game: GameWithCategories): Category | undefined {
  return game.categories.find((c) => (c.listingCount ?? 0) > 0) ?? game.categories[0];
}

/**
 * Раздел игры, как на FunPay: вкладки разделов со счётчиками, фильтры по
 * параметрам раздела и таблица предложений с продавцами.
 */
export async function SectionView({
  game,
  section,
  sp,
}: {
  game: GameWithCategories;
  section: Category;
  sp: SectionSearch;
}) {
  const attributes = (await getCategoryAttributes(section.id)) ?? [];
  const filterable = attributes.filter((a) => a.isFilter);

  // f_<ключ> из адреса → фильтр API. «Да/нет» уходит булевым, значение
  // списка — только из списка: чужой ключ или опция в адресе не доходят до API.
  const attrs: Record<string, string | boolean> = {};
  const values: SectionSearch = {};
  for (const a of filterable) {
    const v = sp[`f_${a.key}`];
    if (!v) continue;
    if (a.type === 'bool' && v === '1') attrs[a.key] = true;
    else if (a.type === 'enum' && a.options?.includes(v)) attrs[a.key] = v;
    else continue;
    values[`f_${a.key}`] = v;
  }
  // В разделе валюты по умолчанию сначала дешёвые: там сравнивают цену за
  // одну и ту же пачку, как в таблицах валюты на FunPay.
  const defaultSort = section.unitName && section.pricePerUnits ? 'price_asc' : 'new';
  const sort = SORTS.includes(sp.sort ?? '') ? sp.sort! : defaultSort;
  if (sort !== defaultSort) values.sort = sort;
  if (sp.online === '1') values.online = '1';
  const q = sp.q?.trim().slice(0, 100);
  if (q) values.q = q;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const browse = await browseListings({
    gameSlug: game.slug,
    categorySlug: section.slug,
    q,
    sort,
    attrs: Object.keys(attrs).length ? JSON.stringify(attrs) : undefined,
    online: values.online === '1',
    limit: PAGE_SIZE,
    page,
  });
  const items = browse?.items ?? [];
  const total = browse?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Object.keys(values).some((k) => k !== 'sort');
  const base = `/igra/${game.slug}/${section.slug}`;
  const pageHref = (n: number) => {
    const p = new URLSearchParams(values as Record<string, string>);
    if (n > 1) p.set('page', String(n));
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const sellHref = `/cabinet/new?game=${encodeURIComponent(game.slug)}&category=${encodeURIComponent(section.slug)}`;

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <Link href="/igry" className="faint" style={{ fontSize: 14 }}>
        ← Все игры
      </Link>
      <div className="section-top" style={{ marginTop: 12 }}>
        <div>
          <h1 className="h1">{game.title}</h1>
          <p className="muted">
            {section.title} · {offersCount(section.listingCount ?? total)}
          </p>
        </div>
        <Link href={sellHref} className="btn secondary">
          Продать в разделе
        </Link>
      </div>

      <nav className="tabs" aria-label="Разделы игры" style={{ marginTop: 24 }}>
        {game.categories.map((c) => (
          <Link
            key={c.id}
            href={`/igra/${game.slug}/${c.slug}`}
            className="tab"
            aria-current={c.id === section.id ? 'page' : undefined}
          >
            {c.title}
            <span className="count">{c.listingCount ?? 0}</span>
          </Link>
        ))}
      </nav>

      <div style={{ marginTop: 20 }}>
        <SectionFilters key={base} attributes={filterable} values={values} defaultSort={defaultSort} />
      </div>

      <section style={{ marginTop: 20 }} aria-label={`Предложения: ${section.title}`}>
        {items.length > 0 ? (
          <OfferTable items={items} attributes={attributes} />
        ) : (
          <div className="card flat empty-state">
            {filtered ? (
              <>
                <p className="muted">По этим условиям предложений нет.</p>
                <Link href={base} className="btn secondary">
                  Сбросить фильтры
                </Link>
              </>
            ) : (
              <>
                <p className="muted">
                  В разделе «{section.title}» пока нет предложений. Выставьте своё — покупатели этого раздела увидят его
                  первым.
                </p>
                <Link href={sellHref} className="btn secondary">
                  Продать первым
                </Link>
              </>
            )}
          </div>
        )}
      </section>

      {pages > 1 && (
        <nav className="row" aria-label="Страницы" style={{ justifyContent: 'center', gap: 8, marginTop: 24 }}>
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="chip">
              ← Назад
            </Link>
          )}
          <span className="faint" style={{ fontSize: 14 }}>
            {page} из {pages}
          </span>
          {page < pages && (
            <Link href={pageHref(page + 1)} className="chip">
              Дальше →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
