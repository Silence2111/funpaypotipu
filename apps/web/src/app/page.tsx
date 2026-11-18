import Link from 'next/link';
import { ChevronRight, Coins, Gem, Info, KeyRound, LayoutGrid, Sword, UserRound, Wrench } from 'lucide-react';
import type { ComponentType } from 'react';
import { browseListings, getGame, getGameIndex, getPublicPricing, getTopupOffers, SEGMENTS, type ListingCard } from '@/lib/api';
import { pickTopupOffer, topupQuote } from '@gamemarket/shared/topup';
import { GameTopupForm } from '@/components/game-topup-form';
import { formatPrice, offersCount } from '@/lib/format';
import { GameIcon } from '@/components/game-icon';
import { LotCard, coverAmount } from '@/components/lot-card';
import { PromoBanners, type PromoSlide } from '@/components/promo-banners';
import { coverColor, gameIcon } from '@/lib/game-icons';
import { lotTitle } from '@/lib/lot-text';
import { RecentLots } from '@/components/recent-lots';
import { getT } from '@/lib/i18n/server';
import type { T } from '@/lib/i18n/lang';

/** Значки вкладок разделов, как у Playerok: у каждого типа товара свой. */
const SEG_ICON: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  accounts: UserRound, currency: Coins, items: Sword, key: KeyRound, topup: Gem, service: Wrench,
};

/** Число крупно и единица для мини-обложки баннера: «1800 UC» → ['1800', 'UC']. */
function bigOf(l: ListingCard, t: T): [string, string] {
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
  searchParams: Promise<{ account?: string; amount?: string; deleted?: string; segment?: string }>;
}) {
  const query = await searchParams;
  const segment = SEGMENTS.some(([k]) => k === query.segment) ? query.segment : undefined;
  const [index, browse, pricing, steam, t] = await Promise.all([
    getGameIndex(),
    browseListings({ limit: 30, sort: 'new', segment }),
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
  });

  // Сервисы рядом с пополнением, как сетка значков у виджета Playerok: ведут в свои разделы
  const SVC: Array<[string, string]> = [['steam', 'topup'], ['roblox', 'currency'], ['telegram', 'stars'], ['playstation', 'cards'], ['pubg-mobile', 'donate'], ['apple', 'topup']];
  const svc = SVC.filter(([g]) => games.some((x) => x.slug === g));

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

      {topup && (
        <section className="tw" aria-label={t('Пополнить {game}', { game: t.d(topup.game.title) })}>
          <div className="tw__svc">
            {svc.map(([g, c]) => (
              <Link
                key={g}
                href={g === 'steam' ? '#topup' : `/igra/${g}/${c}`}
                className={g === 'steam' ? 'tw__s tw__s--on' : 'tw__s'}
                aria-label={t.d(games.find((x) => x.slug === g)!.title)}
              >
                <GameIcon slug={g} title={games.find((x) => x.slug === g)!.title} size={34} />
              </Link>
            ))}
          </div>
          <GameTopupForm
            variant="row"
            game={topup.game}
            offers={topup.offers}
            returnPath="/"
            initialAccount={(query.account ?? '').slice(0, 120)}
            initialAmount={query.amount ?? ''}
            paymentsDemo={pricing?.paymentsDemo ?? false}
          />
        </section>
      )}

      <section aria-labelledby="feed-title" className="pk-feed">
        <h2 className="sr-only" id="feed-title">
          {t('Предложения')}
        </h2>
        <nav className="pk-tabs" aria-label={t('Типы товаров')}>
          <Link href="/" scroll={false} className={!segment ? 'on' : ''} aria-current={!segment ? 'page' : undefined}>
            <LayoutGrid size={18} strokeWidth={1.9} /> {t('Все')}
          </Link>
          {SEGMENTS.map(([key, label]) => {
            const Ico = SEG_ICON[key] ?? LayoutGrid;
            return (
              <Link
                key={key}
                href={`/?segment=${key}`}
                scroll={false}
                className={segment === key ? 'on' : ''}
                aria-current={segment === key ? 'page' : undefined}
              >
                <Ico size={18} strokeWidth={1.9} /> {t(label)}
              </Link>
            );
          })}
        </nav>
        {pricing?.paymentsDemo && (
          <p className="pk-demo" role="note">
            <Info size={16} strokeWidth={1.9} />
            {t('Это демо-стенд. Лоты с пометкой «Пример» демонстрационные, оплата проходит без списания денег.')}
          </p>
        )}
        {listings.length > 0 ? (
          <div className="gm-lots pk-lots">
            {listings.map((l) => (
              <LotCard key={l.id} l={l} t={t} />
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
