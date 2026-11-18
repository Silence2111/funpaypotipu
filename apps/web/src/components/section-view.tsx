import type { CSSProperties } from 'react';
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
import { LotCard, lotArt } from './lot-card';
import { SectionFilters } from './section-filters';
import { SaveSearch } from './save-search';
import { RequestForm } from './buy-requests';
import { SectionRequests } from './section-requests';
import { JsonLd, breadcrumbLd } from './json-ld';
import { GameChat } from './game-chat';
import { GameIcon } from './game-icon';
import { coverColor, gameIcon } from '@/lib/game-icons';
import type { T } from '@/lib/i18n/lang';

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
  // «Выдача сразу» (часть 141): автовыдача и пополнения — только там, где
  // бывает и ручная; в ключах и пополнениях сразу и так всё.
  const mixed = section.fulfillmentType === 'manual';
  if (mixed && sp.instant === '1') values.instant = '1';
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
      instant: values.instant === '1',
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

  return (
    <div className="container sv" style={{ paddingTop: 8, paddingBottom: 24 }}>
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
      <SectionHero game={game} section={section} sellHref={sellHref} t={t} />

      <div className="section-filters-row" style={{ marginTop: 20 }}>
        {/* В пустом разделе фильтровать и сортировать нечего: только «Сохранить
            поиск» — он и сообщит о первом предложении. */}
        {!empty && (
          <SectionFilters
            key={base}
            attributes={filterable}
            values={values}
            defaultSort={defaultSort}
            instantFilter={mixed}
            maxLabel={
              maxRub
                ? t('до {price}', { price: formatPrice(String(maxRub * 100), 'RUB', t) })
                : undefined
            }
          />
        )}
      </div>

      <section
        style={{ marginTop: 20 }}
        aria-label={t('Предложения: {category}', { category: t.d(section.title) })}
      >
        {items.length > 0 ? (
          <>
            <p className="sh__count">{t('Всего {n}', { n: offersCount(total, t) })}</p>
            {/* Сетка карточек, как выдача раздела у Playerok (была таблица, как у FunPay) */}
            <div className="gm-lots">
              {items.map((l) => (
                <LotCard key={l.id} l={l} t={t} />
              ))}
            </div>
          </>
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
                    'В разделе «{category}» ещё никто не продаёт. Выставьте лот первым, покупатели раздела увидят его сразу. Если покупаете, оставьте запрос или сохраните поиск, и продавцы предложат лоты.',
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

      {/* Конец списка */}
      <div>
        {/* Под списком, как у FunPay: не нашли нужное — запрос продавцам или сохранённый поиск.
            Над списком эти кнопки спорили с фильтрами за внимание. */}
        <div className="save-search-row save-search-row--after">
          <span className="muted">{t('Не нашли нужное?')}</span>
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

      {/* Общий чат игры (часть 133): один на все разделы игры. Свёрнут в строку: пустой блок
          «Пока тихо, напишите первым» под каждым разделом был заглушкой, а не пользой. */}
      <details className="game-chat-fold">
        <summary>{t('Чат игры {game}', { game: t.d(game.title) })}</summary>
        <GameChat slug={game.slug} title={game.title} />
      </details>
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
    <div className="container sv" style={{ paddingTop: 8, paddingBottom: 24 }}>
      <JsonLd
        data={breadcrumbLd([
          [t('Все игры'), '/igry'],
          [t.d(game.title), `/igra/${game.slug}`],
          [t.d(section.title), base],
        ])}
      />
      <SectionHero game={game} section={section} t={t} />

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

/**
 * Шапка раздела по образцу Playerok (18.11.2026): баннер цветом игры (обложка из консоли — фоном, если есть),
 * знак игры бледно, объёмный предмет раздела, значок и заголовок «Аккаунты Counter-Strike 2», цифры
 * раздела; под баннером — вкладки разделов игры с числом предложений.
 */
function SectionHero({ game, section, sellHref, t }: { game: GameWithCategories; section: Category; sellHref?: string; t: T }) {
  const icon = gameIcon(game.slug);
  const people = section.sellers;
  const count = section.listingCount ?? 0;
  return (
    <>
      <div className="sh" style={{ ['--c' as string]: coverColor(game.slug, game.title) } as CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element -- обложка игры из консоли */}
        {game.coverUrl && <img className="sh__photo" src={game.coverUrl} alt="" />}
        {icon && <span className="sh__mark" style={{ WebkitMaskImage: `url(${icon.src})`, maskImage: `url(${icon.src})` }} aria-hidden />}
        {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
        <img className="sh__obj" src={lotArt(section.segment, section.slug)} alt="" />
        <div className="sh__id">
          <GameIcon slug={game.slug} title={game.title} size={72} />
          <div style={{ minWidth: 0 }}>
            <h1 className="sh__h1">{t('{section} {game}', { section: t.d(section.title), game: t.d(game.title) })}</h1>
            <p className="sh__meta">
              {section.minPrice && count > 0 && <span>{t('от {price}', { price: formatPrice(section.minPrice, 'RUB', t) })}</span>}
              {count > 0 && <span>{offersCount(count, t)}</span>}
              {people && people.sellers > 0 && <span>{sellersCount(people.sellers, t)}</span>}
              {people && people.online > 0 && (
                <span className="section-online">
                  <span className="dot-online" aria-hidden /> {t('{n} в сети', { n: people.online })}
                </span>
              )}
            </p>
          </div>
        </div>
        {sellHref && (
          <Link href={sellHref} className="sh__sell">
            {t('Продать в разделе')}
          </Link>
        )}
      </div>
      <nav className="pk-tabs sh__tabs" aria-label={t('Разделы игры')}>
        {game.categories.map((c) => (
          <Link
            key={c.id}
            href={`/igra/${game.slug}/${c.slug}`}
            className={c.id === section.id ? 'on' : ''}
            aria-current={c.id === section.id ? 'page' : undefined}
          >
            {t.d(c.title)}
            {/* Ноль у вкладки на старте площадки читается как «здесь мёртво» */}
            {(c.listingCount ?? 0) > 0 && <span className="sh__n">{c.listingCount}</span>}
            {c.salesClosed && <Lock size={13} strokeWidth={2} aria-label={t('закрыт для продажи')} />}
          </Link>
        ))}
      </nav>
    </>
  );
}
