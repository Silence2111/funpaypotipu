import Link from 'next/link';
import { ShieldCheck, MessagesSquare, Zap } from 'lucide-react';
import { getGames, browseListings, getPublicPricing } from '@/lib/api';
import { GameCardView, ListingCardView } from '@/components/cards';

export default async function HomePage() {
  const [games, browse, instantBrowse, pricing] = await Promise.all([
    getGames(),
    browseListings({ limit: 8, sort: 'new' }),
    browseListings({ limit: 8, instant: true, sort: 'popular' }),
    getPublicPricing(),
  ]);
  const listings = browse?.items ?? [];
  const instant = instantBrowse?.items ?? [];

  // Проценты берём из API, а не пишем в разметке. Не ответил — не обещаем.
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const feeRange =
    pricing && pricing.sellerFeeMinPct > 0
      ? pricing.sellerFeeMinPct === pricing.sellerFeeMaxPct
        ? pct(pricing.sellerFeeMinPct)
        : `${pct(pricing.sellerFeeMinPct)}–${pct(pricing.sellerFeeMaxPct)}`
      : null;
  const payoutFee = pricing?.withdrawal.find((w) => w.key === 'sbp')?.feePct ?? null;

  return (
    <div className="container stack-lg" style={{ paddingTop: 72 }}>
      {/* Hero */}
      <section style={{ textAlign: 'center', maxWidth: 760, margin: '0 auto' }}>
        <h1 className="h1">Игровые товары. Безопасно.</h1>
        <p className="lead">
          Аккаунты, валюта, предметы, ключи и пополнения. Деньги лежат у площадки,
          пока вы не подтвердите, что получили товар.
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 28, gap: 12 }}>
          <Link href="/catalog" className="btn">
            Смотреть лоты
          </Link>
          <Link href="#pricing" className="btn ghost">
            Комиссия и выплаты
          </Link>
        </div>

        {feeRange && (
          <p className="muted" style={{ fontSize: 14, marginTop: 24 }}>
            Комиссия продавца {feeRange}, вывод от {payoutFee != null ? pct(payoutFee) : '—'}.
            Для сравнения: у Playerok 20% с большинства товаров плюс вывод.
          </p>
        )}
      </section>

      {/* Trust */}
      {/* auto-fit, а не repeat(3, 1fr): на телефоне три колонки не сжимаются
          и растягивают документ шире экрана. */}
      <section id="how" className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {[
          {
            icon: ShieldCheck,
            t: 'Эскроу-защита',
            d: 'Деньги у площадки, пока вы не подтвердите получение.',
          },
          {
            icon: MessagesSquare,
            t: 'Чат со сделкой',
            d: 'Общение с продавцом и вся история в одном месте.',
          },
          {
            icon: Zap,
            t: 'Быстрая выдача',
            d: 'Ключи и пополнения — автоматически после оплаты.',
          },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="card">
            <Icon size={22} strokeWidth={1.5} />
            <div style={{ fontWeight: 600, margin: '12px 0 6px' }}>{t}</div>
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
            Ключи и пополнения приходят автоматически сразу после оплаты
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
          <Link href="/catalog" className="muted" style={{ fontSize: 14 }}>
            Весь каталог →
          </Link>
        </div>
        {games && games.length > 0 ? (
          <div className="grid cols-auto">
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
            ['03', 'Проверка', 'У вас есть время проверить. Не подошло — открываете спор.'],
            ['04', 'Подтверждение', 'Подтвердили — продавец получает деньги, вы кэшбэк.'],
          ].map(([n, t, d]) => (
            <li key={n} className="card">
              <div className="faint" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
              <div style={{ fontWeight: 600, margin: '8px 0 6px' }}>{t}</div>
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
  const pct = (v: number) => `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`;
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
