import type { Metadata } from 'next';
import Link from 'next/link';
import { apiTry, getGameIndex, getPublicPricing } from '@/lib/api';
import { getT } from '@/lib/i18n/server';
import type { T } from '@/lib/i18n/lang';
import { SellCalculator, type SellEstimate } from '@/components/sell-calculator';
import { MoveLots } from '@/components/move-lots';
import { GameIcon } from '@/components/game-icon';
import { gameIcon } from '@/lib/game-icons';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
/** С чего калькулятор начинает: скины CS2 за 1 000 ₽ (аккаунты закрыты, часть 122). */
const START = { game: 'cs2', price: 1000 };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Продавать на GameMarket'),
    description: t(
      'Сколько вы получите с продажи скина, ключа или валюты: комиссия, вывод и сумма на руки до регистрации, рядом со ставками FunPay и Playerok.',
    ),
    alternates: { canonical: `${SITE}/prodavat` },
  };
}

/** Процент для витрины: «2,5%», по-английски — «2.5%». */
const pctOf = (t: T) => (v: number) => {
  const s = String(+(v * 100).toFixed(1));
  return `${t.lang === 'en' ? s : s.replace('.', ',')}%`;
};



/**
 * «Продавать на GameMarket» по образцу страницы продавца Playerok (18.11.2026): баннер с предметами
 * и кнопкой, калькулятор «Сколько вы получите» на плите (сумма на руки до регистрации), ставки рядом
 * с FunPay и Playerok (переехали с главной), тёмная плита «Ваши продажи под защитой» и перенос лотов.
 */
export default async function SellPage() {
  const t = await getT();
  const [index, pricing] = await Promise.all([getGameIndex(), getPublicPricing()]);
  // Закрытые для продажи разделы (часть 122) в калькуляторе не предлагаем.
  const games = (index ?? [])
    .map((g) => ({ ...g, categories: g.categories.filter((c) => !c.salesClosed) }))
    .filter((g) => g.categories.length > 0);
  const start = games.find((g) => g.slug === START.game) ?? games[0];
  const category = start?.categories.find((c) => c.slug === 'skins') ?? start?.categories[0];
  // Первый расчёт — на сервере: страница с цифрами приходит целиком.
  const initial = category
    ? await apiTry<SellEstimate>(`/fees/estimate?categoryId=${category.id}&price=${START.price * 100}`)
    : null;
  const pct = (v: number) => `${new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(v * 100)}%`;
  const sbp = pricing?.withdrawal.find((w) => w.key === 'sbp');
  // Где продают: игры и сервисы со знаком, как ряд значков на странице продавца Playerok
  const row = games.filter((g) => gameIcon(g.slug)).sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 14);

  const features: Array<{ art: string; title: string; text: string }> = [
    {
      art: 'shield',
      title: t('Деньги ждут в сделке'),
      text:
        t('Покупатель платит площадке, деньги ждут в сделке. Вы выдали товар, покупатель подтвердил, и деньги на вашем балансе.') +
        (pricing?.autoConfirmHours !== undefined
          ? ` ${t('Если покупатель не подтвердил и не открыл спор, через {h} ч сделка подтвердится сама.', { h: pricing.autoConfirmHours })}`
          : ''),
    },
    {
      art: 'bolt',
      title: t('Автовыдача'),
      text: t('Ключи и коды можно выдавать автоматически. Загрузите их на склад лота, и покупатель получит товар сразу после оплаты.'),
    },
    {
      art: 'gamepad',
      title: t('API для продавцов'),
      text: t('Свой бот или склад подключается через API по ключу, пароль от аккаунта не нужен.'),
    },
    ...(pricing && sbp
      ? [
          {
            art: 'coins',
            title: t('Вывод денег'),
            text: t('Вывод на карту, СБП и ЮMoney {pct}, в USDT {usdt}. Комиссия продавца снижается за продажи, рейтинг и проверенные документы.', {
              pct: pct(sbp.feePct),
              usdt: pct(pricing.withdrawal.find((w) => w.key === 'usdt')?.feePct ?? 0),
            }),
          },
        ]
      : []),
    ...(pricing?.fulfillHours !== undefined
      ? [
          {
            art: 'chat',
            title: t('Срок выдачи'),
            text: t('При ручной выдаче на неё есть {h} ч после оплаты. Иначе заказ отменится и деньги вернутся покупателю.', {
              h: pricing.fulfillHours,
            }),
          },
        ]
      : []),
  ];

  return (
    <div className="container sell-pk">
      <section className="sp-hero">
        <div className="sp-hero__text">
          <span className="pb__kicker">{t('Продавцам')}</span>
          <h1 className="sp-hero__h1">{t('Продавать на GameMarket')}</h1>
          <p className="sp-hero__lead">
            {t('Посчитайте, сколько получите с продажи, ещё до регистрации. Комиссия берётся только с проданного, выставлять лоты бесплатно.')}
          </p>
          <div className="sp-hero__btns">
            <Link href="/cabinet/new" className="pb__cta">
              {t('Выставить лот')}
            </Link>
            <a href="#skolko" className="sp-hero__link">
              {t('Сколько вы получите')} →
            </a>
          </div>
        </div>
        <div className="sp-hero__art" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- свои рендеры */}
          <img className="sp-o sp-o--1" src="/3d/coins.webp" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sp-o sp-o--2" src="/3d/chest.webp" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sp-o sp-o--3" src="/3d/plus.webp" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sp-o sp-o--4" src="/3d/gem.webp" alt="" />
        </div>
      </section>

      {row.length > 0 && (
        <nav className="pk-icons sp-icons" aria-label={t('Популярные игры и сервисы')}>
          {row.map((g) => (
            <Link key={g.id} href={`/igra/${g.slug}`} className="pk-icons__i">
              <GameIcon slug={g.slug} title={g.title} size={64} />
              <span>{t.d(g.title)}</span>
            </Link>
          ))}
        </nav>
      )}

      <section id="skolko" className="sp-calc" aria-labelledby="sp-calc-title">
        <div className="sp-calc__head">
          <h2 className="sp-h2" id="sp-calc-title">{t('Сколько вы получите')}</h2>
          <p className="muted">{t('Выберите игру, раздел и цену: калькулятор покажет комиссию, вывод и сумму на руки.')}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
          <img className="sp-calc__obj" src="/3d/coins.webp" alt="" aria-hidden />
        </div>
        {start && category ? (
          <SellCalculator
            games={games}
            initial={initial}
            initialGame={start.slug}
            initialCategory={category.id}
            initialPrice={START.price}
          />
        ) : (
          <p className="muted">{t('Калькулятор сейчас недоступен. Попробуйте обновить страницу.')}</p>
        )}
      </section>

      {pricing && (
        <section id="pricing" aria-labelledby="pricing-title">
          <h2 className="sp-h2" id="pricing-title">
            {t('Сколько это стоит')}
          </h2>
          <p className="muted" style={{ fontSize: 14, marginTop: -6, marginBottom: 16 }}>
            {t('Ставки конкурентов сверены с их сайтами и справкой 26 сентября 2026 года.')}
          </p>
          <PricingTable pricing={pricing} t={t} />
          <p className="faint" style={{ fontSize: 13, marginTop: 14 }}>
            {t(
              'Комиссия продавца снижается за продажи, рейтинг и подтверждённые документы, до {n} процентных пунктов. Покупатель комиссию площадки не платит.',
              { n: pricing.levelDiscountMaxPp },
            )}
          </p>
        </section>
      )}

      <section className="sp-safe" aria-labelledby="sp-safe-title">
        <div className="sp-safe__head">
          <h2 className="sp-safe__h2" id="sp-safe-title">{t('Ваши продажи под защитой')}</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
          <img className="sp-safe__obj" src="/3d/shield.webp" alt="" aria-hidden />
        </div>
        <div className="sp-safe__grid">
          {features.map((f) => (
            <div key={f.art} className="sp-safe__i">
              {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
              <img src={`/3d/${f.art}.webp`} alt="" width={48} height={48} />
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
        <Link href="/prodavat/api" className="sp-safe__link">
          {t('API для продавцов')} →
        </Link>
      </section>

      {start && <MoveLots games={games} initialGame={start.slug} />}
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
    [t('Кэшбэк покупателю'), pricing.cashbackPct > 0 ? t('{pct} деньгами', { pct: pct(pricing.cashbackPct) }) : t('нет'), t('нет'), t('баллы')],
    [t('Комиссия с покупателя'), t('нет'), t('нет'), t('нет')],
  ];

  return (
    // maxWidth: '100%' обязателен: без него grid-элемент растягивается
    // под min-width таблицы и уносит с собой всю страницу.
    <div className="gm-price" style={{ overflowX: 'auto', maxWidth: '100%' }}>
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
