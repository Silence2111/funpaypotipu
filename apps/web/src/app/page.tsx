import Link from 'next/link';
import { ShieldCheck, MessagesSquare, Zap, Info } from 'lucide-react';
import { getGames, browseListings, getPublicPricing, getTopupOffers } from '@/lib/api';
import { GameCardView, ListingCardView } from '@/components/cards';
import { GameTopupForm } from '@/components/game-topup-form';

export default async function HomePage({
  searchParams,
}: {
  // Логин и сумма возвращаются сюда после входа: виджет открывается заполненным.
  searchParams: Promise<{ account?: string; amount?: string }>;
}) {
  const [games, browse, instantBrowse, pricing, steam, query] = await Promise.all([
    getGames(),
    browseListings({ limit: 8, sort: 'new' }),
    browseListings({ limit: 8, instant: true, sort: 'popular' }),
    getPublicPricing(),
    getTopupOffers('steam'),
    searchParams,
  ]);
  const listings = browse?.items ?? [];
  const instant = instantBrowse?.items ?? [];
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
      {/* Первый экран. Пополнение Steam — самый короткий путь к первой покупке,
          поэтому оно здесь, а не в каталоге; кнопка «Оплатить» — единственный
          акцент экрана, «Смотреть лоты» становится второстепенной. */}
      <section className={topup ? 'hero' : 'hero solo'}>
        <div className="hero-copy">
          <h1 className="h1">Игровые товары. Безопасно.</h1>
          <p className="lead">
            Аккаунты, валюта, предметы, ключи и пополнения. Деньги лежат у площадки,
            пока вы не подтвердите, что получили товар.
          </p>
        </div>
        <div className="hero-actions">
          <div className="row hero-buttons" style={{ marginTop: 28, gap: 12, flexWrap: 'wrap' }}>
            <Link href="/catalog" className={topup ? 'btn secondary lg' : 'btn lg'}>
              Смотреть лоты
            </Link>
            <Link href="/cabinet/new" className="btn ghost lg">
              Продать свой лот
            </Link>
          </div>

          <p className="muted" style={{ fontSize: 14, marginTop: 20 }}>
            Покупателю — без комиссии.
            {feeRange && <> Продавцу — {feeRange}, вывод от {payoutFee != null ? pct(payoutFee) : '—'}.</>}
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

      {/* Trust */}
      {/* auto-fit, а не repeat(3, 1fr): на телефоне три колонки не сжимаются
          и растягивают документ шире экрана. */}
      <section id="how" className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {[
          {
            icon: ShieldCheck,
            t: 'Деньги у площадки',
            d: `Продавец получит оплату, только когда вы подтвердите получение${pricing?.autoConfirmHours ? ` или пройдёт ${pricing.autoConfirmHours} ч без спора` : ''}.`,
          },
          {
            icon: MessagesSquare,
            t: 'Спор с арбитром',
            d: 'Не получили или товар не как в описании — открываете спор, деньги замораживаются до решения.',
          },
          {
            icon: Zap,
            t: 'Ключи сразу',
            d: 'Ключи выдаются автоматически после оплаты, продавца ждать не нужно.',
          },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="card">
            <Icon size={22} strokeWidth={1.75} color="var(--accent)" />
            <div style={{ fontWeight: 700, margin: '12px 0 6px' }}>{t}</div>
            <div className="muted" style={{ fontSize: 14 }}>
              {d}
            </div>
          </div>
        ))}
      </section>

      {/* Instant delivery */}
      {instant.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={20} strokeWidth={1.75} /> Мгновенная выдача
            </h2>
            <Link href="/catalog" className="muted" style={{ fontSize: 14 }}>
              Все →
            </Link>
          </div>
          <p className="muted" style={{ fontSize: 14, marginTop: -8, marginBottom: 16 }}>
            Ключи и пополнения — автоматически после оплаты
            {pricing ? ` · ${pct(pricing.cashbackPct)} кэшбэка на баланс` : ''}
          </p>
          <div className="grid cols-auto">
            {instant.map((l) => (
              <ListingCardView key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}

      {/* Games */}
      <section id="games">
        <div className="section-head">
          <h2 className="h2">Игры</h2>
          <Link href="/igry" className="muted" style={{ fontSize: 14 }}>
            Все игры А–Я →
          </Link>
        </div>
        {games && games.length > 0 ? (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {games.map((g) => (
              <GameCardView key={g.id} game={g} />
            ))}
          </div>
        ) : (
          <EmptyGames />
        )}
      </section>

      {/* Recent listings */}
      <section>
        <div className="section-head">
          <h2 className="h2">Новые лоты</h2>
          <Link href="/catalog" className="muted" style={{ fontSize: 14 }}>
            Все →
          </Link>
        </div>
        {listings.length > 0 ? (
          <div className="grid cols-auto">
            {listings.map((l) => (
              <ListingCardView key={l.id} listing={l} />
            ))}
          </div>
        ) : (
          <EmptyListings />
        )}
      </section>

      {/* Pricing */}
      {pricing && (
        <section id="pricing">
          <div className="section-head">
            <h2 className="h2">Сколько это стоит</h2>
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

      {/* Как проходит сделка */}
      <section>
        <div className="section-head">
          <h2 className="h2">Как проходит сделка</h2>
        </div>
        <ol
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 16,
            padding: 0,
            listStyle: 'none',
          }}
        >
          {[
            ['01', 'Оплата', 'Деньги уходят не продавцу, а на эскроу-счёт площадки.'],
            ['02', 'Передача', 'Продавец передаёт товар. Ключи и пополнения — автоматически.'],
            ['03', 'Проверка', `У вас ${pricing?.autoConfirmHours ?? 72} ч, чтобы проверить. Не подошло — открываете спор.`],
            ['04', 'Подтверждение', 'Подтвердили — продавец получает деньги, вы кэшбэк.'],
          ].map(([n, t, d]) => (
            <li key={n} className="card">
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{n}</div>
              <div style={{ fontWeight: 700, margin: '8px 0 6px' }}>{t}</div>
              <div className="muted" style={{ fontSize: 14 }}>{d}</div>
            </li>
          ))}
        </ol>
      </section>
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

/**
 * Пустые состояния раньше говорили с разработчиком: «Запустите API и БД,
 * затем выполните pnpm db:seed». Человек, зашедший купить ключ, читал
 * инструкцию по развёртыванию.
 */
function EmptyGames() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Каталог пока собирается</p>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Игры появятся, как только продавцы выложат первые лоты.
      </p>
    </div>
  );
}

function EmptyListings() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Лотов пока нет</p>
      <p className="muted" style={{ margin: '0 0 16px', fontSize: 14 }}>
        Если вам есть что продать — вы будете первым в каталоге.
      </p>
      <Link href="/cabinet/new" className="btn">
        Выложить лот
      </Link>
    </div>
  );
}
