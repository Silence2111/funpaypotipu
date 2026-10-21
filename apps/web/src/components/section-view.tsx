import Link from 'next/link';
import { browseListings, getCategoryAttributes, type Category, type GameWithCategories } from '@/lib/api';
import { formatPrice, offersCount, sellersCount } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import { OfferTable } from './offers';
import { SectionFilters } from './section-filters';
import { SaveSearch } from './save-search';
import { JsonLd, breadcrumbLd } from './json-ld';

/** Параметры адреса раздела: f_<ключ>, online, drop, q, max (цена до, ₽), sort, page. */
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
  const t = await getT();
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
  if (sp.drop === '1') values.drop = '1';
  const q = sp.q?.trim().slice(0, 100);
  if (q) values.q = q;
  // «Цена до» — из сохранённого поиска: ссылка из уведомления показывает
  // ровно то, что подобрал поиск. Рубли, целым числом.
  const maxRub = /^\d{1,8}$/.test(sp.max ?? '') && Number(sp.max) > 0 ? Number(sp.max) : null;
  if (maxRub) values.max = String(maxRub);
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const browse = await browseListings({
    gameSlug: game.slug,
    categorySlug: section.slug,
    q,
    sort,
    attrs: Object.keys(attrs).length ? JSON.stringify(attrs) : undefined,
    online: values.online === '1',
    drop: values.drop === '1',
    maxPrice: maxRub ? maxRub * 100 : undefined,
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
  const people = section.sellers;

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <JsonLd
        data={breadcrumbLd([
          [t('Все игры'), '/igry'],
          [t.d(game.title), `/igra/${game.slug}`],
          [t.d(section.title), base],
        ])}
      />
      <Link href="/igry" className="faint back-link" style={{ fontSize: 14 }}>
        ← {t('Все игры')}
      </Link>
      <div className="section-top" style={{ marginTop: 12 }}>
        <div>
          <h1 className="h1">{t.d(game.title)}</h1>
          <p className="muted section-meta">
            {t.d(section.title)} · {offersCount(section.listingCount ?? total, t)}
            {people && people.sellers > 0 && <> · {sellersCount(people.sellers, t)}</>}
            {people && people.online > 0 && (
              <>
                {' · '}
                <span className="section-online">
                  <span className="dot-online" aria-hidden /> {t('{n} в сети', { n: people.online })}
                </span>
              </>
            )}
          </p>
        </div>
        <Link href={sellHref} className="btn secondary">
          {t('Продать в разделе')}
        </Link>
      </div>

      <nav className="tabs" aria-label={t('Разделы игры')} style={{ marginTop: 24 }}>
        {game.categories.map((c) => (
          <Link
            key={c.id}
            href={`/igra/${game.slug}/${c.slug}`}
            className="tab"
            aria-current={c.id === section.id ? 'page' : undefined}
          >
            {t.d(c.title)}
            <span className="count">{c.listingCount ?? 0}</span>
          </Link>
        ))}
      </nav>

      <div style={{ marginTop: 20 }}>
        <SectionFilters
          key={base}
          attributes={filterable}
          values={values}
          defaultSort={defaultSort}
          maxLabel={maxRub ? t('до {price}', { price: formatPrice(String(maxRub * 100), 'RUB', t) }) : undefined}
        />
        <div className="save-search-row">
          <SaveSearch
            categoryId={section.id}
            attrs={attrs}
            q={q || null}
            maxRub={maxRub}
            summary={[
              ...filterable
                .filter((a) => a.key in attrs)
                .map((a) => (attrs[a.key] === true ? t.d(a.label) : `${t.d(a.label)}: ${t.d(String(attrs[a.key]))}`)),
              ...(q ? [t('«{q}»', { q })] : []),
            ]}
          />
        </div>
      </div>

      <section style={{ marginTop: 20 }} aria-label={t('Предложения: {category}', { category: t.d(section.title) })}>
        {items.length > 0 ? (
          <OfferTable items={items} attributes={attributes} t={t} />
        ) : (
          <div className="card flat empty-state">
            {filtered ? (
              <>
                <p className="muted">{t('По этим условиям предложений нет.')}</p>
                <Link href={base} className="btn secondary">
                  {t('Сбросить фильтры')}
                </Link>
              </>
            ) : (
              <>
                <p className="muted">
                  {t('В разделе «{category}» пока нет предложений. Выставьте своё — покупатели этого раздела увидят его первым.', {
                    category: t.d(section.title),
                  })}
                </p>
                <Link href={sellHref} className="btn secondary">
                  {t('Продать первым')}
                </Link>
              </>
            )}
          </div>
        )}
      </section>

      {pages > 1 && (
        <nav className="row" aria-label={t('Страницы')} style={{ justifyContent: 'center', gap: 8, marginTop: 24 }}>
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="chip">
              ← {t('Назад')}
            </Link>
          )}
          <span className="faint" style={{ fontSize: 14 }}>
            {t('{page} из {pages}', { page, pages })}
          </span>
          {page < pages && (
            <Link href={pageHref(page + 1)} className="chip">
              {t('Дальше')} →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
