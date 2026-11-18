import Link from 'next/link';
import { ChevronRight, Info } from 'lucide-react';
import { browseListings, getGame, getGameIndex, getPublicPricing, getTopupOffers, SEGMENTS, type ListingCard } from '@/lib/api';
import { pickTopupOffer, topupQuote } from '@gamemarket/shared/topup';
import { GameTopupForm } from '@/components/game-topup-form';
import { formatListingPrice, formatPrice, offersCount } from '@/lib/format';
import { GameIcon } from '@/components/game-icon';
import { LotCard, coverAmount, lotArt } from '@/components/lot-card';
import { PromoBanners, type PromoSlide } from '@/components/promo-banners';
import { QuickBuy, type QuickTab } from '@/components/quick-buy';
import { coverColor, gameIcon } from '@/lib/game-icons';
import { lotTitle } from '@/lib/lot-text';
import { RecentLots } from '@/components/recent-lots';
import { getT } from '@/lib/i18n/server';
import { msg, type T } from '@/lib/i18n/lang';

/** Объёмные значки вкладок, как у Playerok: у каждого типа товара свой предмет (рендеры `дизайн/3d`). */
const SEG_3D: Record<string, string> = {
  accounts: 'account', currency: 'coins', items: 'chest', key: 'key', topup: 'gem', service: 'wrench',
};

/** Число крупно и единица для мини-обложки баннера: «1800 UC» → ['1800', 'UC']. */
function bigOf(l: ListingCard, t: T): [string, string] {
  // у валюты пачка из лота: «100 Robux», «1 000 000 виртов»
  if (l.unitName && l.pricePerUnits) return [l.pricePerUnits.toLocaleString(t.locale), l.unitName];
  const a = coverAmount(lotTitle(l, t.lang));
  if (!a) return [t.d(l.category.title), ''];
  const [n, ...u] = a.split(' ');
  return [n, u.join(' ')];
}

/**
 * Главная по устройству Playerok (18.11.2026, владелец: «посмотри, как у Playerok всё устроено,
 * давай основываться на них»): баннеры, ряд значков игр, пополнение Steam одной строкой,
 * вкладки типов товаров и лента лотов плитками по пять в ряд. Лендинг со слоганом, таблица ставок
 * и указатель А–Я ушли: ставки — на «Продавать», все игры — на /igry.
 */
export default async function HomePage({
  searchParams,
}: {
  // Логин и сумма возвращаются сюда после входа: виджет открывается заполненным.
  // deleted — дата уничтожения данных после удаления аккаунта (часть 124). segment — вкладка ленты.
  searchParams: Promise<{ account?: string; amount?: string; deleted?: string; segment?: string; sort?: string }>;
}) {
  const query = await searchParams;
  const segment = SEGMENTS.some(([k]) => k === query.segment) ? query.segment : undefined;
  // Вкладки сортировки ленты, как «Новинки / Лидеры продаж / Дешевле» у SteamBuy и Kupikod
  const FEED_SORTS: Array<[string, string]> = [['new', msg('Новые')], ['popular', msg('Популярные')], ['price_asc', msg('Дешевле')]];
  const sort = FEED_SORTS.some(([k]) => k === query.sort) ? query.sort! : 'new';
  const [index, browse, pricing, steam, t] = await Promise.all([
    getGameIndex(),
    browseListings({ limit: 30, sort, segment }),
    getPublicPricing(),
    getTopupOffers('steam'),
    getT(),
  ]);
  const games = index ?? [];
  const listings = browse?.items ?? [];
  const total = browse?.total ?? listings.length;
  const topup = steam && steam.offers.length > 0 ? steam : null;

  // Ряд значков: игры и сервисы с настоящим знаком, по популярности каталога
  const iconRow = games
    .filter((g) => gameIcon(g.slug))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    .slice(0, 16);

  // Баннеры — разделы, где есть предложения, с самыми дешёвыми настоящими лотами
  const PROMO: Array<[string, string]> = [['roblox', 'currency'], ['telegram', 'stars'], ['pubg-mobile', 'donate'], ['playstation', 'cards']];
  const promoGames = await Promise.all(PROMO.map(([g]) => getGame(g)));
  const promoLots = await Promise.all(
    PROMO.map(([g, c]) => browseListings({ gameSlug: g, categorySlug: c, sort: 'price_asc', limit: 3 })),
  );
  const slides: PromoSlide[] = [];
  if (topup) {
    const minMarkup = Math.min(...topup.offers.map((o) => o.markupBps));
    slides.push({
      key: 'steam',
      kicker: t('Пополнение Steam'),
      title: t('Steam за минуту, по одному логину'),
      sub: t('Пароль не нужен. Наценка продавца от {pct}, деньги у площадки до зачисления.', {
        pct: `${String(+(minMarkup / 100).toFixed(1)).replace('.', t.lang === 'en' ? '.' : ',')}%`,
      }),
      href: '#topup',
      cta: t('Пополнить'),
      color: coverColor('steam', 'Steam'),
      mark: gameIcon('steam')?.src,
      art: '/3d/card.webp',
      // Суммы пополнения и цена к оплате — той же функцией, что считает заказ на сервере
      lots: [500, 1000, 2000].flatMap((rub) => {
        const terms = topup.offers.map((o) => ({ ...o, min: BigInt(o.min), max: BigInt(o.max) }));
        const offer = pickTopupOffer(terms, BigInt(rub * 100));
        if (!offer) return [];
        const q = topupQuote(BigInt(rub * 100), offer.markupBps);
        return [{ id: `steam-${rub}`, big: String(rub), unit: t('₽ на Steam'), price: formatPrice(q.price.toString(), 'RUB', t), color: '#1a9fff' }];
      }),
    });
  }
  PROMO.forEach(([g, c], i) => {
    const game = promoGames[i];
    const sec = game?.categories.find((x) => x.slug === c);
    const lots = promoLots[i]?.items ?? [];
    if (!game || !sec || !sec.listingCount || lots.length === 0) return;
    slides.push({
      key: `${g}-${c}`,
      kicker: t.d(game.title),
      title: sec.minPrice
        ? t('{section} от {price}', { section: t.d(sec.title), price: formatPrice(sec.minPrice, 'RUB', t) })
        : t.d(sec.title),
      sub: t('{n} с гарантией сделки: деньги у площадки, пока вы не подтвердите получение.', {
        n: offersCount(sec.listingCount, t),
      }),
      href: `/igra/${game.slug}/${sec.slug}`,
      cta: t('Смотреть предложения'),
      color: coverColor(game.slug, game.title),
      mark: gameIcon(game.slug)?.src,
      art: lotArt(lots[0]?.category.segment, c),
      lots: lots.slice(0, 3).map((l) => {
        const [big, unit] = bigOf(l, t);
        return { id: l.id, big, unit, price: formatPrice(l.price, l.currency, t), color: coverColor(l.game.slug, l.game.title) };
      }),
    });
  });
  slides.push({
    key: 'garant',
    kicker: t('Гарантия сделки'),
    title: t('Деньги у площадки, пока вы не получили товар'),
    sub: pricing?.autoConfirmHours
      ? t('Не пришло или не как в описании: откройте спор, деньги заморозятся до решения. Без спора продавец получит оплату через {n} ч.', {
          n: pricing.autoConfirmHours,
        })
      : t('Не пришло или не как в описании: откройте спор, деньги заморозятся до решения.'),
    href: '/rules',
    cta: t('Как защищена сделка'),
    color: 'var(--accent)',
    art: '/3d/shield.webp',
  });


  // Бегущая лента «только что выставили»: настоящие свежие лоты с временем
  const fresh = (await browseListings({ limit: 14, sort: 'new' }))?.items ?? [];
  const ago = (iso: string) => {
    const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 60) return t('{n} мин назад', { n: m });
    const h = Math.round(m / 60);
    return h < 48 ? t('{n} ч назад', { n: h }) : t('{n} дн назад', { n: Math.round(h / 24) });
  };

  // Быстрая покупка: вкладки сервисов с самыми дешёвыми лотами раздела (Steam — форма пополнения)
  const QB: Array<[string, string]> = [['telegram', 'stars'], ['roblox', 'currency'], ['playstation', 'cards'], ['pubg-mobile', 'donate'], ['apple', 'cards']];
  const qbGames = await Promise.all(QB.map(([g]) => getGame(g)));
  const qbLots = await Promise.all(QB.map(([g, c]) => browseListings({ gameSlug: g, categorySlug: c, sort: 'price_asc', limit: 4 })));
  const quickTabs: QuickTab[] = QB.flatMap(([g, c], i) => {
    const game = qbGames[i];
    const sec = game?.categories.find((x) => x.slug === c);
    const lots = qbLots[i]?.items ?? [];
    if (!game || !sec || lots.length === 0) return [];
    return [{
      key: `${g}-${c}`, slug: g, title: game.title, section: sec.title, href: `/igra/${g}/${c}`,
      color: coverColor(g, game.title), art: lotArt(sec.segment, sec.slug), big: t.d(sec.title),
      from: sec.minPrice ? formatPrice(sec.minPrice, 'RUB', t) : null,
      offers: lots.slice(0, 4).map((l) => {
        const [big, unit] = bigOf(l, t);
        return { id: l.id, title: lotTitle(l, t.lang), price: formatPrice(l.price, l.currency, t), full: formatListingPrice(l, t), color: coverColor(l.game.slug, l.game.title), big, unit,
          art: lotArt(l.category.segment, l.category.slug) };
      }),
    }];
  });

  // «Пополнение и подписки» плитками, как у Kupikod: сервисы с предложениями и ценой «от»
  const services = games
    .filter((g) => g.kind === 'app' && gameIcon(g.slug) && g.categories.some((c) => c.listingCount > 0))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 12);
  const svcFull = await Promise.all(services.map((g) => getGame(g.slug)));
  const svcTiles = services.map((g, i) => {
    const cats = (svcFull[i]?.categories ?? []).filter((c) => (c.listingCount ?? 0) > 0);
    const mins = cats.map((c) => c.minPrice).filter((x): x is string => !!x).map(BigInt);
    const min = mins.length ? mins.reduce((a, b) => (a < b ? a : b)) : null;
    return { g, n: cats.reduce((a, c) => a + (c.listingCount ?? 0), 0), min, first: cats[0]?.slug };
  });


  const deletedUntil = /^\d{4}-\d{2}-\d{2}$/.test(query.deleted ?? '') ? new Date(`${query.deleted}T00:00:00Z`) : null;

  return (
    <div className="container home pk-home">
      <h1 className="sr-only">{t('GameMarket, маркетплейс цифровых игровых товаров')}</h1>
      {deletedUntil && (
        <div className="alert" role="status">
          {t('Аккаунт удалён. До {date} его можно вернуть: войдите и нажмите «Восстановить». Потом почта, имя и вход будут уничтожены.', {
            date: deletedUntil.toLocaleDateString(t.locale),
          })}
        </div>
      )}

      <PromoBanners slides={slides} />

      {iconRow.length > 0 && (
        <nav className="pk-icons" aria-label={t('Популярные игры и сервисы')}>
          {iconRow.map((g) => (
            <Link key={g.id} href={`/igra/${g.slug}`} className="pk-icons__i">
              <GameIcon slug={g.slug} title={g.title} size={80} />
              <span>{t.d(g.title)}</span>
            </Link>
          ))}
          <Link href="/igry" className="pk-icons__i pk-icons__all">
            <span className="pk-icons__more">
              <ChevronRight size={26} strokeWidth={2} />
            </span>
            <span>{t('Все игры')}</span>
          </Link>
        </nav>
      )}

      {fresh.length > 0 && (
        <div className="tk" aria-label={t('Только что выставили')}>
          <span className="tk__lbl">
            <i aria-hidden /> {t('Только что выставили')}
          </span>
          <div className="tk__win">
            <div className="tk__run">
              {[0, 1].map((k) => (
                <span key={k} className="tk__set" aria-hidden={k === 1}>
                  {fresh.map((l) => (
                    <Link key={`${k}-${l.id}`} href={`/lot/${l.id}`} className="tk__i" tabIndex={k === 1 ? -1 : 0}>
                      <GameIcon slug={l.game.slug} title={l.game.title} size={22} />
                      <b>{lotTitle(l, t.lang)}</b>
                      <span>{formatPrice(l.price, l.currency, t)}</span>
                      <small>{ago(l.createdAt)}</small>
                    </Link>
                  ))}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <QuickBuy
        tabs={quickTabs}
        steam={
          topup
            ? {
                title: t('Пополнить {game}', { game: t.d(topup.game.title) }),
                sub: t('Нужен только логин, пароль не нужен'),
                color: coverColor('steam', 'Steam'),
                art: '/3d/card.webp',
                big: 'Steam',
                form: (
                  <GameTopupForm
                    variant="pk"
                    game={topup.game}
                    offers={topup.offers}
                    returnPath="/"
                    initialAccount={(query.account ?? '').slice(0, 120)}
                    initialAmount={query.amount ?? ''}
                    paymentsDemo={pricing?.paymentsDemo ?? false}
                    cashbackPct={pricing?.cashbackPct ?? 0}
                  />
                ),
              }
            : null
        }
      />

      {svcTiles.length > 0 && (
        <section className="pk-svc reveal" aria-labelledby="svc-title">
          <div className="pk-h">
            <h2 id="svc-title">{t('Пополнение и подписки')}</h2>
            <Link href="/igry?vid=app">{t('Все сервисы')} →</Link>
          </div>
          <div className="pk-svc__grid">
            {svcTiles.map(({ g, n, min, first }) => (
              <Link key={g.id} href={first ? `/igra/${g.slug}/${first}` : `/igra/${g.slug}`} className="pk-svc__i">
                <GameIcon slug={g.slug} title={g.title} size={56} />
                <b>{t.d(g.title)}</b>
                <span>{min ? t('от {price}', { price: formatPrice(min.toString(), 'RUB', t) }) : offersCount(n, t)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="feed-title" className="pk-feed">
        <h2 className="sr-only" id="feed-title">
          {t('Предложения')}
        </h2>
        <nav className="pk-tabs" aria-label={t('Типы товаров')}>
          <Link href={sort !== 'new' ? `/?sort=${sort}` : '/'} scroll={false} className={!segment ? 'on' : ''} aria-current={!segment ? 'page' : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
            <img src="/3d/grid.webp" alt="" width={28} height={28} /> {t('Все')}
          </Link>
          {SEGMENTS.map(([key, label]) => (
            <Link
              key={key}
              href={`/?segment=${key}`}
              scroll={false}
              className={segment === key ? 'on' : ''}
              aria-current={segment === key ? 'page' : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
              <img src={`/3d/${SEG_3D[key] ?? 'grid'}.webp`} alt="" width={28} height={28} /> {t(label)}
            </Link>
          ))}
        </nav>
        <div className="pk-sort" role="group" aria-label={t('Сортировка')}>
          {FEED_SORTS.map(([k, label]) => {
            const qs = new URLSearchParams({ ...(segment ? { segment } : {}), ...(k !== 'new' ? { sort: k } : {}) }).toString();
            return (
              <Link key={k} href={qs ? `/?${qs}` : '/'} scroll={false} className="chip" aria-current={sort === k ? 'page' : undefined}>
                {t(label)}
              </Link>
            );
          })}
        </div>
        {pricing?.paymentsDemo && (
          <p className="pk-demo" role="note">
            <Info size={16} strokeWidth={1.9} />
            {t('Это демо-стенд. Лоты с пометкой «Пример» демонстрационные, оплата проходит без списания денег.')}
          </p>
        )}
        {listings.length > 0 ? (
          <div className="gm-lots pk-lots">
            {listings.map((l) => (
              <LotCard key={l.id} l={l} t={t} cashback={pricing?.cashbackPct} />
            ))}
          </div>
        ) : (
          <p className="muted">{t('Здесь пока нет предложений.')}</p>
        )}
        {total > listings.length && (
          <div className="pk-more">
            <Link href={segment ? `/catalog?segment=${segment}` : '/catalog'} className="pk-more__b">
              {t('Показать ещё')}
            </Link>
          </div>
        )}
      </section>

      <RecentLots />
    </div>
  );
}
