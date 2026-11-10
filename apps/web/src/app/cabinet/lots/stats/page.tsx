'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STATS_PERIODS, type StatsPeriod } from '@gamemarket/shared/lot-stats';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';
import { msg, type T } from '@/lib/i18n/lang';

interface Day {
  day: string;
  views: number;
  purchases: number;
}
interface LotRow {
  id: string;
  title: string;
  status: string;
  views: number;
  totalViews: number;
  favorites: number;
  purchases: number;
  earned: string;
  conversion: number | null;
}
interface Stats {
  from: string;
  to: string;
  listingId: string | null;
  totals: {
    views: number;
    favorites: number;
    purchases: number;
    earned: string;
    conversion: number | null;
  };
  daily: Day[];
  lots: LotRow[];
}

const STATUS: Record<string, string> = {
  paused: msg('снят с продажи'),
  sold_out: msg('закончился'),
  blocked: msg('заблокирован'),
  draft: msg('черновик'),
};

const dayLabel = (iso: string, t: T) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(t.locale, { day: 'numeric', month: 'short' });
const pct = (x: number | null, t: T) =>
  x === null ? '—' : `${new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(x)}%`;

/**
 * Просмотры по дням — столбцы одного цвета. Наведение или фокус с
 * клавиатуры показывает день: просмотры и покупки. Покупки — только в
 * подсказке и таблице: у них свой масштаб, вторую ось не рисуем.
 */
function ViewsChart({ daily, t }: { daily: Day[]; t: T }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...daily.map((d) => d.views), 0);
  const active = hover === null ? null : daily[hover];
  return (
    <div className="daily-chart">
      <div className="daily-scale" aria-hidden>
        <span>{t.num(max)}</span>
        <span>0</span>
      </div>
      <div className="daily-plot" onMouseLeave={() => setHover(null)}>
        <div className="daily-bars">
          {daily.map((d, i) => {
            const h = max > 0 ? (d.views / max) * 100 : 0;
            return (
              <button
                key={d.day}
                type="button"
                className="daily-slot"
                aria-label={t('{day}: просмотров {views}, покупок {purchases}', {
                  day: dayLabel(d.day, t),
                  views: d.views,
                  purchases: d.purchases,
                })}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                {h > 0 && <span className="daily-bar" style={{ height: `max(${h}%, 3px)` }} />}
              </button>
            );
          })}
        </div>
        {active && hover !== null && (
          <div
            className="daily-tip"
            role="status"
            style={(() => {
              // У краёв подсказка прижимается внутрь, а не вылезает за карточку.
              const at = (hover + 0.5) / daily.length;
              const shift = at < 0.2 ? '0%' : at > 0.8 ? '-100%' : '-50%';
              return { left: `${at * 100}%`, transform: `translate(${shift}, -100%)` };
            })()}
          >
            <b>{dayLabel(active.day, t)}</b>
            <span>{t('Просмотров: {n}', { n: t.num(active.views) })}</span>
            <span>{t('Покупок: {n}', { n: t.num(active.purchases) })}</span>
          </div>
        )}
        <div className="daily-axis" aria-hidden>
          <span>{dayLabel(daily[0]!.day, t)}</span>
          <span>{dayLabel(daily[daily.length - 1]!.day, t)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Статистика лотов продавца: просмотры, избранное, покупки, конверсия и
 * заработанное за 7, 30 или 90 дней, график просмотров по дням — всех
 * лотов или одного. Просмотр считается раз в сутки с браузера, свои — нет.
 */
export default function LotStatsPage() {
  const t = useT();
  const router = useRouter();
  const [days, setDays] = useState<StatsPeriod>(30);
  const [lot, setLot] = useState<string | null>(null);
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/lots/stats');
      return;
    }
    setErr(null);
    apiFetch<Stats>(`/lot-stats?days=${days}${lot ? `&listingId=${lot}` : ''}`)
      .then(setS)
      .catch((e) => setErr(apiErrorMessage(e, t('Статистика не загрузилась.'))));
  }, [days, lot, router, t]);

  const chosen = s?.lots.find((l) => l.id === lot);
  const tiles: Array<[string, string]> = s
    ? [
        [t('Просмотры'), t.num(s.totals.views)],
        [t('В избранном'), t.num(s.totals.favorites)],
        [t('Покупки'), t.num(s.totals.purchases)],
        [t('Конверсия'), pct(s.totals.conversion, t)],
        [t('Заработано'), formatPrice(s.totals.earned, 'RUB', t)],
      ]
    : [];

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Статистика лотов')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t(
            'Сколько раз открывали ваши лоты, добавляли в избранное и покупали. Просмотр считается раз в сутки с одного браузера, ваши собственные — нет.',
          )}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <section className="stats">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {STATS_PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              className="chip"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
            >
              {t('{n} дней', { n: d })}
            </button>
          ))}
          <Link href="/cabinet/lots" className="chip" style={{ marginLeft: 'auto' }}>
            ← {t('Мои лоты')}
          </Link>
        </div>
        {err && (
          <div className="alert error" role="alert">
            {err}
          </div>
        )}

        {!s ? (
          <div className="skeleton" style={{ height: 320 }} aria-busy="true" />
        ) : (
          <>
            <div className="stats-tiles">
              {tiles.map(([label, value]) => (
                <div key={label} className="card stats-tile">
                  <div className="stats-label">{label}</div>
                  <div className="stats-value">{value}</div>
                </div>
              ))}
            </div>
            <p className="hint">
              {t(
                'Покупки — заказы, оплаченные за эти дни; заработано — по сделкам, завершённым за эти дни, после комиссии. В избранном — сейчас.',
              )}
            </p>

            <div className="card stats-hero">
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <h2 className="h2" style={{ fontSize: 16, margin: 0, minWidth: 0 }}>
                  {chosen
                    ? t('Просмотры: {title}', { title: chosen.title })
                    : t('Просмотры по дням')}
                </h2>
                {lot && (
                  <button
                    type="button"
                    className="chip"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => setLot(null)}
                  >
                    {t('Все лоты')}
                  </button>
                )}
              </div>
              {s.daily.some((d) => d.views > 0) ? (
                <ViewsChart daily={s.daily} t={t} />
              ) : (
                <p className="muted" style={{ margin: '12px 0 0' }}>
                  {t('За эти дни просмотров не было.')}
                </p>
              )}
              <details className="stats-table">
                <summary>{t('По дням таблицей')}</summary>
                <table>
                  <thead>
                    <tr>
                      <th>{t('День')}</th>
                      <th>{t('Просмотры')}</th>
                      <th>{t('Покупки')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...s.daily].reverse().map((d) => (
                      <tr key={d.day}>
                        <td>{dayLabel(d.day, t)}</td>
                        <td>{t.num(d.views)}</td>
                        <td>{t.num(d.purchases)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>

            {s.lots.length === 0 ? (
              <div className="card flat empty-state">
                <p className="muted">{t('Лотов пока нет — статистика появится после первого.')}</p>
                <Link href="/cabinet/new" className="btn secondary">
                  {t('Продать лот')}
                </Link>
              </div>
            ) : (
              <div className="card lot-stats">
                <table>
                  <thead>
                    <tr>
                      <th>{t('Лот')}</th>
                      <th>{t('Просмотры')}</th>
                      <th>{t('В избранном')}</th>
                      <th>{t('Покупки')}</th>
                      <th>{t('Конверсия')}</th>
                      <th>{t('Заработано')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.lots.map((l) => (
                      <tr key={l.id} aria-selected={l.id === lot}>
                        <td>
                          <button
                            type="button"
                            className="lot-stats-name"
                            aria-pressed={l.id === lot}
                            title={t('Показать график этого лота')}
                            onClick={() => setLot(l.id === lot ? null : l.id)}
                          >
                            {l.title}
                          </button>
                          {STATUS[l.status] && (
                            <span className="badge">{t(STATUS[l.status]!)}</span>
                          )}
                          <div className="hint">
                            {t('всего просмотров: {n}', { n: t.num(l.totalViews) })}
                          </div>
                        </td>
                        <td data-label={t('Просмотры')}>{t.num(l.views)}</td>
                        <td data-label={t('В избранном')}>{t.num(l.favorites)}</td>
                        <td data-label={t('Покупки')}>{t.num(l.purchases)}</td>
                        <td data-label={t('Конверсия')}>{pct(l.conversion, t)}</td>
                        <td data-label={t('Заработано')}>{formatPrice(l.earned, 'RUB', t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
