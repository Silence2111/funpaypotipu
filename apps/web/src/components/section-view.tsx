import Link from 'next/link';
import { Lock } from 'lucide-react';
import {
  browseListings,
  getBuyRequests,
  getCategoryAttributes,
  type Category,
  type GameWithCategories,
} from '@/lib/api';
import { formatPrice, offersCount, sellersCount } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import { OfferTable } from './offers';
import { SectionFilters } from './section-filters';
import { SaveSearch } from './save-search';
import { RequestForm } from './buy-requests';
import { SectionRequests } from './section-requests';
import { JsonLd, breadcrumbLd } from './json-ld';

/** Параметры адреса раздела: f_<ключ>, online, drop, q, max (цена до, ₽), sort, page. */
export type SectionSearch = Record<string, string | undefined>;

const PAGE_SIZE = 50;
const SORTS = ['new', 'price_asc', 'price_desc', 'popular', 'drop'];

/**
 * Раздел для /igra/<игра>: первый открытый с предложениями, а если пусто
 * везде — первый открытый. Закрытый для продажи (часть 122) — только если
 * других нет: «Аккаунты» стоят первыми, а продавать в них нельзя.
 */
export function defaultSection(game: GameWithCategories): Category | undefined {
  const open = game.categories.filter((c) => !c.salesClosed);
  return open.find((c) => (c.listingCount ?? 0) > 0) ?? open[0] ?? game.categories[0];
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
  if (section.salesClosed) return <ClosedSection game={game} section={section} />;
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

  const [browse, requests] = await Promise.all([
    browseListings({
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
    }),
    getBuyRequests(section.id),
  ]);
  const items = browse?.items ?? [];
  const total = browse?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Object.keys(values).some((k) => k !== 'sort');
  // В разделе нет ни одного предложения — не «по фильтрам», а вовсе.
  const empty = !filtered && total === 0;
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
      {/* Цена от и число предложений — для сниппета поиска. */}
      {section.minPrice && (section.listingCount ?? 0) > 0 && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: `${t.d(section.title)} ${t.d(game.title)}`,
            offers: {
              '@type': 'AggregateOffer',
              priceCurrency: 'RUB',
              lowPrice: (Number(section.minPrice) / 100).toFixed(2),
              offerCount: section.listingCount,
            },
          }}
        />
      )}
      <Link href="/igry" className="faint back-link" style={{ fontSize: 14 }}>
        ← {t('Все игры')}
      </Link>
      <div className="section-top" style={{ marginTop: 12 }}>
        <div>
          <h1 className="h1">{t.d(game.title)}</h1>
          <p className="muted section-meta">
            {t.d(section.title)}
            {section.minPrice && (section.listingCount ?? 0) > 0 && (
              <> · {t('от {price}', { price: formatPrice(section.minPrice, 'RUB', t) })}</>
            )}
            {(section.listingCount ?? total) > 0 && (
              <> · {offersCount(section.listingCount ?? total, t)}</>
            )}
            {people && people.sellers > 0 && <> · {sellersCount(people.sellers, t)}</>}
            {people && people.online > 0 && (
              <>
                {' · '}
                <span className="section-online">
                  <span className="dot-online" aria-hidden />{' '}
                  {t('{n} в сети', { n: people.online })}
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
            {/* Ноль у каждой вкладки на старте площадки читается как «здесь мёртво». */}
            {(c.listingCount ?? 0) > 0 && <span className="count">{c.listingCount}</span>}
            {c.salesClosed && <Lock size={12} strokeWidth={2} aria-label={t('закрыт для продажи')} />}
          </Link>
        ))}
      </nav>

      <div style={{ marginTop: 20 }}>
        {/* В пустом разделе фильтровать и сортировать нечего: только «Сохранить
            поиск» — он и сообщит о первом предложении. */}
        {!empty && (
          <SectionFilters
            key={base}
            attributes={filterable}
            values={values}
            defaultSort={defaultSort}
            maxLabel={
              maxRub
                ? t('до {price}', { price: formatPrice(String(maxRub * 100), 'RUB', t) })
                : undefined
            }
          />
        )}
        <div className="save-search-row">
          {/* В пустом разделе «Оставить запрос» — у карточки ниже, крупной кнопкой. */}
          {!empty && <RequestForm categoryId={section.id} />}
          <SaveSearch
            categoryId={section.id}
            attrs={attrs}
            q={q || null}
            maxRub={maxRub}
            summary={[
              ...filterable
                .filter((a) => a.key in attrs)
                .map((a) =>
                  attrs[a.key] === true
                    ? t.d(a.label)
                    : `${t.d(a.label)}: ${t.d(String(attrs[a.key]))}`,
                ),
              ...(q ? [t('«{q}»', { q })] : []),
            ]}
          />
        </div>
      </div>

      <section
        style={{ marginTop: 20 }}
        aria-label={t('Предложения: {category}', { category: t.d(section.title) })}
      >
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
                <h2 className="h2" style={{ fontSize: 20, margin: 0 }}>
                  {t('Предложений пока нет')}
                </h2>
                <p className="muted">
                  {t(
                    'В разделе «{category}» ещё никто не продаёт. Выставьте лот первым — покупатели раздела увидят его сразу. Покупаете? Оставьте запрос — продавцы предложат лоты, или сохраните поиск.',
                    {
                      category: t.d(section.title),
                    },
                  )}
                </p>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Link href={sellHref} className="btn">
                    {t('Выставить лот первым')}
                  </Link>
                  <RequestForm categoryId={section.id} primary />
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {pages > 1 && (
        <nav
          className="row"
          aria-label={t('Страницы')}
          style={{ justifyContent: 'center', gap: 8, marginTop: 24 }}
        >
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

      <SectionRequests
        total={requests?.total ?? 0}
        items={requests?.items ?? []}
        sellHref={sellHref}
      />
    </div>
  );
}

/**
 * Раздел закрыт для продажи (часть 122): вместо витрины — почему и куда
 * идти. Лотов, фильтров, «Продать в разделе» и запросов здесь нет.
 */
async function ClosedSection({ game, section }: { game: GameWithCategories; section: Category }) {
  const t = await getT();
  const base = `/igra/${game.slug}/${section.slug}`;
  const open = game.categories.filter((c) => !c.salesClosed);
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
      <h1 className="h1" style={{ marginTop: 12 }}>
        {t.d(game.title)}
      </h1>
      <p className="muted section-meta">{t.d(section.title)}</p>

      <nav className="tabs" aria-label={t('Разделы игры')} style={{ marginTop: 24 }}>
        {game.categories.map((c) => (
          <Link
            key={c.id}
            href={`/igra/${game.slug}/${c.slug}`}
            className="tab"
            aria-current={c.id === section.id ? 'page' : undefined}
          >
            {t.d(c.title)}
            {(c.listingCount ?? 0) > 0 && <span className="count">{c.listingCount}</span>}
            {c.salesClosed && <Lock size={12} strokeWidth={2} aria-label={t('закрыт для продажи')} />}
          </Link>
        ))}
      </nav>

      <section className="card flat empty-state closed-section" style={{ marginTop: 20 }} aria-labelledby="closed-title">
        <Lock size={22} strokeWidth={1.75} aria-hidden />
        <h2 id="closed-title" className="h2" style={{ fontSize: 20, margin: 0 }}>
          {t('Раздел закрыт для продажи')}
        </h2>
        <p className="muted" style={{ maxWidth: 560 }}>
          {section.closedReason ? t.d(section.closedReason) : t('Продажа в разделе закрыта правилами площадки.')}
        </p>
        {open.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {open.map((c) => (
              <Link key={c.id} href={`/igra/${game.slug}/${c.slug}`} className="btn secondary">
                {t.d(c.title)}
                {(c.listingCount ?? 0) > 0 && <span className="faint"> · {c.listingCount}</span>}
              </Link>
            ))}
          </div>
        )}
        <Link href="/rules#zapreshcheno" className="faint" style={{ fontSize: 14 }}>
          {t('Что нельзя продавать на GameMarket')}
        </Link>
      </section>
    </div>
  );
}
