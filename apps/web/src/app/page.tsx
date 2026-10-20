import Link from 'next/link';
import { ShieldCheck, MessagesSquare, Zap, Info } from 'lucide-react';
import { browseListings, getGameIndex, getPublicPricing, getTopupOffers, SEGMENTS } from '@/lib/api';
import { GameTopupForm } from '@/components/game-topup-form';
import { GameSearch } from '@/components/game-search';
import { GameDirectory, PopularGames } from '@/components/game-directory';
import { OfferTable } from '@/components/offers';
import { getT } from '@/lib/i18n/server';
import type { T } from '@/lib/i18n/lang';

/** Процент для витрины: «2,5%», по-английски — «2.5%». */
const pctOf = (t: T) => (v: number) => {
  const s = String(+(v * 100).toFixed(1));
  return `${t.lang === 'en' ? s : s.replace('.', ',')}%`;
};

/**
 * Главная — каталог, как у бирж: поиск по играм, популярные игры, свежие
 * предложения и все игры от А до Я. Раньше здесь был лендинг со слоганом
 * и тремя преимуществами, а до игр нужно было долистать.
 */
export default async function HomePage({
  searchParams,
}: {
  // Логин и сумма возвращаются сюда после входа: виджет открывается заполненным.
  searchParams: Promise<{ account?: string; amount?: string }>;
}) {
  const [index, browse, pricing, steam, query, t] = await Promise.all([
    getGameIndex(),
    browseListings({ limit: 8, sort: 'new' }),
    getPublicPricing(),
    getTopupOffers('steam'),
    searchParams,
    getT(),
  ]);
  const games = index ?? [];
  const listings = browse?.items ?? [];
  const topup = steam && steam.offers.length > 0 ? steam : null;

  // Проценты берём из API, а не пишем в разметке. Не ответил — не обещаем.
  // 2,5% — не «3%»: округление до целого на витрине завышало ставку вывода
  const pct = pctOf(t);
  const feeRange =
    pricing && pricing.sellerFeeMinPct > 0
      ? pricing.sellerFeeMinPct === pricing.sellerFeeMaxPct
        ? pct(pricing.sellerFeeMinPct)
        : `${pct(pricing.sellerFeeMinPct)}–${pct(pricing.sellerFeeMaxPct)}`
      : null;
  const payoutFee = pricing?.withdrawal.find((w) => w.key === 'sbp')?.feePct ?? null;

  return (
    <div className="container stack-lg home">
      {/* Первый экран: поиск по играм и пополнение Steam — самый короткий путь
          к первой покупке. «Оплатить» в виджете — единственный акцент экрана. */}
      <section className={topup ? 'home-hero' : undefined}>
        <div>
          <h1 className="h1">{t('Игровые товары. Безопасно.')}</h1>
          <p className="lead">
            {games.length > 0
              ? t('{n} игр и сервисов: аккаунты, валюта, предметы, ключи и донат.', { n: games.length })
              : t('Аккаунты, валюта, предметы, ключи и донат.')}{' '}
            {t('Деньги лежат у площадки, пока вы не подтвердите, что получили товар.')}
          </p>
          <div style={{ marginTop: 24 }}>
            <GameSearch index={games} size="lg" />
          </div>
          <nav className="type-chips" aria-label={t('Типы товаров')}>
            {SEGMENTS.map(([key, label]) => (
              <Link key={key} href={`/catalog?segment=${key}`} className="chip">
                {t(label)}
              </Link>
            ))}
          </nav>
          <p className="muted" style={{ fontSize: 14, marginTop: 20 }}>
            {t('Покупателю — без комиссии.')}
            {feeRange && (
              <>
                {' '}
                {t('Продавцу — {fee}, вывод от {payout}.', {
                  fee: feeRange,
                  payout: payoutFee != null ? pct(payoutFee) : '—',
                })}
              </>
            )}{' '}
            <Link href="/cabinet/new" className="inline-link">
              {t('Продать свой лот')}
            </Link>
          </p>
        </div>

        {topup && (
          <GameTopupForm
            variant="hero"
            game={topup.game}
            offers={topup.offers}
            returnPath="/"
            initialAccount={(query.account ?? '').slice(0, 120)}
            initialAmount={query.amount ?? ''}
            paymentsDemo={pricing?.paymentsDemo ?? false}
          />
        )}
      </section>

      {pricing?.paymentsDemo && (
        <div className="alert" role="note" style={{ maxWidth: 760, margin: '32px auto 0' }}>
          <Info size={18} strokeWidth={1.75} />
          <span>
            {t(
              'Это демо-стенд. Лоты с пометкой «Пример» — демонстрационные, а оплата проходит без списания денег: платёжный провайдер ещё не подключён.',
            )}
          </span>
        </div>
      )}

      {games.length > 0 && (
        <section aria-labelledby="popular-title">
          <div className="section-head">
            <h2 className="h2" id="popular-title">
              {t('Популярные')}
            </h2>
            <a href="#catalog" className="muted" style={{ fontSize: 14 }}>
              {t('Все игры')} →
            </a>
          </div>
          <PopularGames games={games} />
        </section>
      )}

      {listings.length > 0 && (
        <section aria-labelledby="fresh-title">
          <div className="section-head">
            <h2 className="h2" id="fresh-title">
              {t('Новые предложения')}
            </h2>
            <Link href="/catalog" className="muted" style={{ fontSize: 14 }}>
              {t('Все')} →
            </Link>
          </div>
          <OfferTable items={listings} showSection t={t} />
        </section>
      )}

      {games.length > 0 && (
        <section id="catalog" aria-labelledby="catalog-title" style={{ scrollMarginTop: 80 }}>
          <div className="section-head" style={{ flexWrap: 'wrap', gap: 12 }}>
            <h2 className="h2" id="catalog-title">
              {t('Все игры от А до Я')}
            </h2>
            <div className="kind-links">
              <Link href="/igry?vid=game" className="chip">
                {t('Игры')}
              </Link>
              <Link href="/igry?vid=mobile" className="chip">
                {t('Мобильные')}
              </Link>
              <Link href="/igry?vid=app" className="chip">
                {t('Приложения')}
              </Link>
            </div>
          </div>
          <GameDirectory games={games} />
        </section>
      )}

      <section aria-labelledby="trust-title">
        <h2 className="h2" id="trust-title" style={{ marginBottom: 20 }}>
          {t('Как защищена сделка')}
        </h2>
        <div className="trust-row">
          <div>
            <h3>
              <ShieldCheck size={18} strokeWidth={1.75} aria-hidden /> {t('Деньги у площадки')}
            </h3>
            <p>
              {pricing?.autoConfirmHours
                ? t('Продавец получит оплату, когда вы подтвердите получение или через {n} ч без спора.', {
                    n: pricing.autoConfirmHours,
                  })
                : t('Продавец получит оплату, когда вы подтвердите получение.')}
            </p>
          </div>
          <div>
            <h3>
              <MessagesSquare size={18} strokeWidth={1.75} aria-hidden /> {t('Спор с арбитром')}
            </h3>
            <p>{t('Не получили или товар не как в описании — открываете спор, деньги замораживаются до решения.')}</p>
          </div>
          <div>
            <h3>
              <Zap size={18} strokeWidth={1.75} aria-hidden /> {t('Ключи сразу')}
            </h3>
            <p>
              {pricing
                ? t('Ключи и пополнения выдаются автоматически после оплаты, а с каждой покупки — {pct} кэшбэка на баланс.', {
                    pct: pct(pricing.cashbackPct),
                  })
                : t('Ключи и пополнения выдаются автоматически после оплаты.')}
            </p>
          </div>
        </div>
        <p style={{ marginTop: 16, fontSize: 14 }}>
          <Link href="/rules" className="inline-link">
            {t('Правила и гарантии')}
          </Link>
        </p>
      </section>

      {pricing && (
        <section id="pricing" aria-labelledby="pricing-title">
          <div className="section-head">
            <h2 className="h2" id="pricing-title">
              {t('Сколько это стоит')}
            </h2>
          </div>
          <p className="muted" style={{ fontSize: 14, marginTop: -8, marginBottom: 16 }}>
            {t('Ставки конкурентов сверены с их сайтами и справкой 26 сентября 2026 года.')}
          </p>
          <PricingTable pricing={pricing} t={t} />
          <p className="faint" style={{ fontSize: 13, marginTop: 14 }}>
            {t(
              'Комиссия продавца снижается за продажи, рейтинг и подтверждённые документы — до {n} процентных пунктов. Покупатель комиссию площадки не платит.',
              { n: pricing.levelDiscountMaxPp },
            )}
          </p>
        </section>
      )}
    </div>
  );
}

function PricingTable({
  pricing,
  t,
}: {
  pricing: NonNullable<Awaited<ReturnType<typeof getPublicPricing>>>;
  t: T;
}) {
  const pct = pctOf(t);
  const range =
    pricing.sellerFeeMinPct === pricing.sellerFeeMaxPct
      ? pct(pricing.sellerFeeMinPct)
      : `${pct(pricing.sellerFeeMinPct)}–${pct(pricing.sellerFeeMaxPct)}`;
  const sbp = pricing.withdrawal.find((w) => w.key === 'sbp');
  const usdt = pricing.withdrawal.find((w) => w.key === 'usdt');

  const rows: Array<[string, string, string, string]> = [
    [t('Комиссия продавца'), range, t('в среднем 9%, от 3%'), t('10% и 20%')],
    [t('Вывод на карту и СБП'), sbp ? pct(sbp.feePct) : '—', t('3%, минимум 30 ₽'), t('6%, минимум 60 ₽')],
    [t('Вывод в USDT'), usdt ? pct(usdt.feePct) : '—', '—', t('4% плюс 1 $')],
    [t('Кэшбэк покупателю'), t('{pct} деньгами', { pct: pct(pricing.cashbackPct) }), t('нет'), t('баллы')],
    [t('Комиссия с покупателя'), t('нет'), t('нет'), t('нет')],
  ];

  return (
    // maxWidth: '100%' обязателен: без него grid-элемент растягивается
    // под min-width таблицы и уносит с собой всю страницу.
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '10px 12px 10px 0', fontWeight: 500 }} />
            <th style={{ textAlign: 'left', padding: '10px 12px 10px 0', fontWeight: 600 }}>GameMarket</th>
            <th style={{ textAlign: 'left', padding: '10px 12px 10px 0', fontWeight: 500, color: 'var(--fg-muted)' }}>FunPay</th>
            <th style={{ textAlign: 'left', padding: '10px 0', fontWeight: 500, color: 'var(--fg-muted)' }}>Playerok</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, us, funpay, playerok]) => (
            <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 12px 10px 0', color: 'var(--fg-muted)' }}>{label}</td>
              <td style={{ padding: '10px 12px 10px 0', fontWeight: 600 }}>{us}</td>
              <td style={{ padding: '10px 12px 10px 0', color: 'var(--fg-muted)' }}>{funpay}</td>
              <td style={{ padding: '10px 0', color: 'var(--fg-muted)' }}>{playerok}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
