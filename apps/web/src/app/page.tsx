import Link from 'next/link';
import { ShieldCheck, MessagesSquare, Zap, Info } from 'lucide-react';
import { browseListings, getGameIndex, getPublicPricing, getTopupOffers, SEGMENTS } from '@/lib/api';
import { GameTopupForm } from '@/components/game-topup-form';
import { GameSearch } from '@/components/game-search';
import { GameDirectory, PopularGames } from '@/components/game-directory';
import { OfferTable } from '@/components/offers';

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
  const [index, browse, pricing, steam, query] = await Promise.all([
    getGameIndex(),
    browseListings({ limit: 8, sort: 'new' }),
    getPublicPricing(),
    getTopupOffers('steam'),
    searchParams,
  ]);
  const games = index ?? [];
  const listings = browse?.items ?? [];
  const topup = steam && steam.offers.length > 0 ? steam : null;

  // Проценты берём из API, а не пишем в разметке. Не ответил — не обещаем.
  // 2,5% — не «3%»: округление до целого на витрине завышало ставку вывода
  const pct = (v: number) => `${String(+(v * 100).toFixed(1)).replace('.', ',')}%`;
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
          <h1 className="h1">Игровые товары. Безопасно.</h1>
          <p className="lead">
            {games.length > 0 ? `${games.length} игр и сервисов: ` : ''}аккаунты, валюта, предметы, ключи и донат.
            Деньги лежат у площадки, пока вы не подтвердите, что получили товар.
          </p>
          <div style={{ marginTop: 24 }}>
            <GameSearch index={games} size="lg" />
          </div>
          <nav className="type-chips" aria-label="Типы товаров">
            {SEGMENTS.map(([key, label]) => (
              <Link key={key} href={`/catalog?segment=${key}`} className="chip">
                {label}
              </Link>
            ))}
          </nav>
          <p className="muted" style={{ fontSize: 14, marginTop: 20 }}>
            Покупателю — без комиссии.
            {feeRange && <> Продавцу — {feeRange}, вывод от {payoutFee != null ? pct(payoutFee) : '—'}.</>}{' '}
            <Link href="/cabinet/new" className="inline-link">
              Продать свой лот
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
            Это демо-стенд. Лоты с пометкой «Пример» — демонстрационные, а оплата
            проходит без списания денег: платёжный провайдер ещё не подключён.
          </span>
        </div>
      )}

      {games.length > 0 && (
        <section aria-labelledby="popular-title">
          <div className="section-head">
            <h2 className="h2" id="popular-title">
              Популярные
            </h2>
            <a href="#catalog" className="muted" style={{ fontSize: 14 }}>
              Все игры →
            </a>
          </div>
          <PopularGames games={games} />
        </section>
      )}

      {listings.length > 0 && (
        <section aria-labelledby="fresh-title">
          <div className="section-head">
            <h2 className="h2" id="fresh-title">
              Новые предложения
            </h2>
            <Link href="/catalog" className="muted" style={{ fontSize: 14 }}>
              Все →
            </Link>
          </div>
          <OfferTable items={listings} showSection />
        </section>
      )}

      {games.length > 0 && (
        <section id="catalog" aria-labelledby="catalog-title" style={{ scrollMarginTop: 80 }}>
          <div className="section-head" style={{ flexWrap: 'wrap', gap: 12 }}>
            <h2 className="h2" id="catalog-title">
              Все игры от А до Я
            </h2>
            <div className="kind-links">
              <Link href="/igry?vid=game" className="chip">
                Игры
              </Link>
              <Link href="/igry?vid=mobile" className="chip">
                Мобильные
              </Link>
              <Link href="/igry?vid=app" className="chip">
                Приложения
              </Link>
            </div>
          </div>
          <GameDirectory games={games} />
        </section>
      )}

      <section aria-labelledby="trust-title">
        <h2 className="h2" id="trust-title" style={{ marginBottom: 20 }}>
          Как защищена сделка
        </h2>
        <div className="trust-row">
          <div>
            <h3>
              <ShieldCheck size={18} strokeWidth={1.75} aria-hidden /> Деньги у площадки
            </h3>
            <p>
              Продавец получит оплату, когда вы подтвердите получение
              {pricing?.autoConfirmHours ? ` или через ${pricing.autoConfirmHours} ч без спора` : ''}.
            </p>
          </div>
          <div>
            <h3>
              <MessagesSquare size={18} strokeWidth={1.75} aria-hidden /> Спор с арбитром
            </h3>
            <p>Не получили или товар не как в описании — открываете спор, деньги замораживаются до решения.</p>
          </div>
          <div>
            <h3>
              <Zap size={18} strokeWidth={1.75} aria-hidden /> Ключи сразу
            </h3>
            <p>
              Ключи и пополнения выдаются автоматически после оплаты
              {pricing ? `, а с каждой покупки — ${pct(pricing.cashbackPct)} кэшбэка на баланс` : ''}.
            </p>
          </div>
        </div>
        <p style={{ marginTop: 16, fontSize: 14 }}>
          <Link href="/rules" className="inline-link">
            Правила и гарантии
          </Link>
        </p>
      </section>

      {pricing && (
        <section id="pricing" aria-labelledby="pricing-title">
          <div className="section-head">
            <h2 className="h2" id="pricing-title">
              Сколько это стоит
            </h2>
          </div>
          <p className="muted" style={{ fontSize: 14, marginTop: -8, marginBottom: 16 }}>
            Ставки конкурентов сверены с их сайтами и справкой 26 сентября 2026 года.
          </p>
          <PricingTable pricing={pricing} />
          <p className="faint" style={{ fontSize: 13, marginTop: 14 }}>
            Комиссия продавца снижается за продажи, рейтинг и подтверждённые
            документы — до {pricing.levelDiscountMaxPp} процентных пунктов.
            Покупатель комиссию площадки не платит.
          </p>
        </section>
      )}
    </div>
  );
}

function PricingTable({
  pricing,
}: {
  pricing: NonNullable<Awaited<ReturnType<typeof getPublicPricing>>>;
}) {
  const pct = (v: number) => `${String(+(v * 100).toFixed(1)).replace('.', ',')}%`;
  const range =
    pricing.sellerFeeMinPct === pricing.sellerFeeMaxPct
      ? pct(pricing.sellerFeeMinPct)
      : `${pct(pricing.sellerFeeMinPct)}–${pct(pricing.sellerFeeMaxPct)}`;
  const sbp = pricing.withdrawal.find((w) => w.key === 'sbp');
  const usdt = pricing.withdrawal.find((w) => w.key === 'usdt');

  const rows: Array<[string, string, string, string]> = [
    ['Комиссия продавца', range, 'в среднем 9%, от 3%', '10% и 20%'],
    ['Вывод на карту и СБП', sbp ? pct(sbp.feePct) : '—', '3%, минимум 30 ₽', '6%, минимум 60 ₽'],
    ['Вывод в USDT', usdt ? pct(usdt.feePct) : '—', '—', '4% плюс 1 $'],
    ['Кэшбэк покупателю', pct(pricing.cashbackPct) + ' деньгами', 'нет', 'баллы'],
    ['Комиссия с покупателя', 'нет', 'нет', 'нет'],
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
