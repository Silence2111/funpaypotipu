'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { downloadFile } from '@/lib/download';
import { formatPrice } from '@/lib/format';

interface Day {
  day: string;
  orders: number;
  gmv: string;
  revenue: string;
}
interface Summary {
  from: string;
  to: string;
  currency: string;
  gmv: string;
  revenue: string;
  avgOrder: string;
  orders: { created: number; paid: number; completed: number; refunded: number; disputes: number };
  users: { new: number; activeSellers: number; activeBuyers: number };
  payouts: { paidCount: number; paidSum: string; pendingCount: number; pendingSum: string };
  balances: { users: string; escrow: string };
  daily: Day[];
}

const PERIODS = [7, 30, 90] as const;
const rub = (v: string) => formatPrice(v, 'RUB');
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
/** Подпись оси: 1,2 млн ₽ / 350 тыс. ₽ — круглое число, а не копейки. */
const compact = (minor: string) =>
  `${new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(minor) / 100)} ₽`;

/**
 * Оборот по дням — столбцы одного цвета, наведение (или фокус с клавиатуры)
 * показывает день целиком. Таблица тех же чисел — под графиком.
 */
function DailyChart({ daily }: { daily: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...daily.map((d) => Number(d.gmv)), 0);
  const active = hover === null ? null : daily[hover];
  return (
    <div className="daily-chart">
      <div className="daily-scale" aria-hidden>
        <span>{max > 0 ? compact(String(max)) : ''}</span>
        <span>0</span>
      </div>
      <div className="daily-plot" onMouseLeave={() => setHover(null)}>
        <div className="daily-bars">
          {daily.map((d, i) => {
            const pct = max > 0 ? (Number(d.gmv) / max) * 100 : 0;
            return (
              <button
                key={d.day}
                type="button"
                className="daily-slot"
                aria-label={`${dayLabel(d.day)}: оборот ${rub(d.gmv)}, сделок ${d.orders}, доход ${rub(d.revenue)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                {pct > 0 && <span className="daily-bar" style={{ height: `max(${pct}%, 3px)` }} />}
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
            <b>{dayLabel(active.day)}</b>
            <span>Оборот {rub(active.gmv)}</span>
            <span>Сделок {active.orders}</span>
            <span>Доход {rub(active.revenue)}</span>
          </div>
        )}
        <div className="daily-axis" aria-hidden>
          <span>{dayLabel(daily[0]!.day)}</span>
          <span>{dayLabel(daily[daily.length - 1]!.day)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Сводка для владельца и финансов: оборот и доход площадки за период,
 * сделки, люди, выплаты и деньги, которые площадка держит, — на балансах
 * пользователей и в сделках. Деньги — из журнала проводок.
 */
interface Registry {
  thresholds: { dailyUsers: number; sellers: number; turnover: string };
  last: { year: number; sellers: number; turnover: string; near: boolean; reached: boolean } | null;
  current: { year: number; sellers: number; turnover: string; near: boolean; reached: boolean };
}

/**
 * Пороги реестра по 289-ФЗ (часть 145): где площадка относительно порогов.
 * Итоги прошлого года площадка считает сама в январе и пишет администраторам.
 * Только администратору: другим ролям карточка не показывается.
 */
function RegistryCard() {
  const [r, setR] = useState<Registry | null>(null);
  useEffect(() => {
    apiFetch<Registry>('/admin/erasure/registry').then(setR).catch(() => setR(null));
  }, []);
  if (!r) return null;
  const line = (m: Registry['current']) =>
    `${m.year}: продавцов со сделками ${m.sellers} из ${r.thresholds.sellers.toLocaleString('ru-RU')}, оборот ${rub(m.turnover)} из 50 млрд ₽`;
  return (
    <div className="card" style={{ padding: 16, marginTop: 16, display: 'grid', gap: 6, fontSize: 14 }}>
      <b>Пороги реестра платформ (289-ФЗ)</b>
      <span>{line(r.current)} — на сегодня</span>
      {r.last && <span>{line(r.last)} — итоги года</span>}
      <span className="hint">
        В реестр — от {r.thresholds.dailyUsers.toLocaleString('ru-RU')} пользователей в день (смотреть в Метрике) и одного из порогов
        выше. {r.current.near || r.last?.near ? 'Половина порога пройдена — пора готовить требования закона: ПРОДУКТ/289-ФЗ.md.' : 'До порогов далеко.'}
      </span>
    </div>
  );
}

interface Funnel {
  days: number;
  byDay: Array<{ day: string; registered: number; firstLot: number; firstRequest: number; firstPaid: number; firstDeal: number }>;
  cohort: { registered: number; firstLot: number; firstRequest: number; firstPaid: number; firstDeal: number };
}

const FUNNEL: Array<{ key: keyof Funnel['cohort']; label: string }> = [
  { key: 'registered', label: 'Зарегистрировались' },
  { key: 'firstLot', label: 'Выставили первый лот' },
  { key: 'firstRequest', label: 'Оставили запрос «Хочу купить»' },
  { key: 'firstPaid', label: 'Оплатили первый заказ' },
  { key: 'firstDeal', label: 'Завершили первую сделку' },
];
const pctOf = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/**
 * Воронка запуска (часть 131) — по нашей базе: из зарегистрировавшихся за
 * период сколько дошли до каждого шага. Полоса — доля от регистраций; по
 * дням — кто сделал свой первый шаг в этот день. Внешних счётчиков не нужно.
 */
function FunnelCard({ days }: { days: number }) {
  const [f, setF] = useState<Funnel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setF(null);
    setErr(null);
    apiFetch<Funnel>(`/admin/funnel?days=${days}`)
      .then(setF)
      .catch((e) => setErr(apiErrorMessage(e, 'Воронка не загрузилась.')));
  }, [days]);
  if (err) return <div className="alert error" role="alert">{err}</div>;
  if (!f) return <div className="skeleton" style={{ height: 220 }} aria-busy="true" />;
  const base = f.cohort.registered;
  return (
    <div className="card funnel">
      <h3 className="h2" style={{ fontSize: 16, margin: 0 }}>Воронка запуска</h3>
      <p className="hint" style={{ margin: '4px 0 16px' }}>
        Кто зарегистрировался за {days} дней и до какого шага дошёл к сегодняшнему дню.
      </p>
      <ol className="funnel-steps">
        {FUNNEL.map((st) => {
          const n = f.cohort[st.key];
          const pct = pctOf(n, base);
          return (
            <li key={st.key}>
              <span className="funnel-label">{st.label}</span>
              <span className="funnel-track" aria-hidden>
                <span className="funnel-bar" style={{ width: `${base > 0 ? Math.max(pct, n > 0 ? 2 : 0) : 0}%` }} />
              </span>
              <span className="funnel-value">
                <b>{n}</b>
                {st.key !== 'registered' && <span className="faint"> · {pct}%</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <details className="stats-table" style={{ marginTop: 16 }}>
        <summary>Первые шаги по дням</summary>
        <table>
          <thead>
            <tr>
              <th>День</th>
              <th>Регистрации</th>
              <th>Первый лот</th>
              <th>Первый запрос</th>
              <th>Первая оплата</th>
              <th>Первая сделка</th>
            </tr>
          </thead>
          <tbody>
            {f.byDay.map((d) => (
              <tr key={d.day}>
                <td>{dayLabel(d.day)}</td>
                <td>{d.registered}</td>
                <td>{d.firstLot}</td>
                <td>{d.firstRequest}</td>
                <td>{d.firstPaid}</td>
                <td>{d.firstDeal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function StatsSection() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setS(null);
    apiFetch<Summary>(`/reports/platform?days=${days}`)
      .then(setS)
      .catch((e) => setErr(apiErrorMessage(e, 'Сводка не загрузилась.')));
  }, [days]);

  async function download() {
    setErr(null);
    try {
      await downloadFile(`/reports/platform.csv?days=${days}`);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Файл не скачался.'));
    }
  }

  const tiles: Array<[string, string]> = s
    ? [
        ['Доход площадки', rub(s.revenue)],
        ['Сделок завершено', String(s.orders.completed)],
        ['Средний чек', rub(s.avgOrder)],
        ['Заказов создано', String(s.orders.created)],
        ['Новых пользователей', String(s.users.new)],
        ['Продавцов с продажами', String(s.users.activeSellers)],
        ['Покупателей', String(s.users.activeBuyers)],
        ['Споров открыто', String(s.orders.disputes)],
      ]
    : [];

  return (
    <section className="stats">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {PERIODS.map((d) => (
          <button
            key={d}
            type="button"
            className="chip"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
          >
            {d} дней
          </button>
        ))}
        <button
          type="button"
          className="chip"
          style={{ marginLeft: 'auto' }}
          onClick={() => void download()}
        >
          <Download size={16} strokeWidth={1.75} aria-hidden /> Для Excel
        </button>
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
          <div className="card stats-hero">
            <div className="stats-label">Оборот за {days} дней</div>
            <div className="stats-hero-value">{rub(s.gmv)}</div>
            <div className="hint">
              Сумма завершённых сделок с {dayLabel(s.from)} по {dayLabel(s.to)}, по московскому
              времени.
            </div>
            <DailyChart daily={s.daily} />
          </div>

          <div className="stats-tiles">
            {tiles.map(([label, value]) => (
              <div key={label} className="card stats-tile">
                <div className="stats-label">{label}</div>
                <div className="stats-value">{value}</div>
              </div>
            ))}
          </div>

          <div className="card stats-money">
            <h3 className="h2" style={{ fontSize: 16, margin: 0 }}>
              Деньги
            </h3>
            <dl>
              <div>
                <dt>На балансах пользователей</dt>
                <dd>{rub(s.balances.users)}</dd>
              </div>
              <div>
                <dt>В сделках, до подтверждения</dt>
                <dd>{rub(s.balances.escrow)}</dd>
              </div>
              <div>
                <dt>Выплачено за период · {s.payouts.paidCount}</dt>
                <dd>{rub(s.payouts.paidSum)}</dd>
              </div>
              <div>
                <dt>Ждут выплаты · {s.payouts.pendingCount}</dt>
                <dd>{rub(s.payouts.pendingSum)}</dd>
              </div>
            </dl>
          </div>

          <FunnelCard days={days} />

          <details className="stats-table">
            <summary>По дням таблицей</summary>
            <table>
              <thead>
                <tr>
                  <th>День</th>
                  <th>Сделок</th>
                  <th>Оборот</th>
                  <th>Доход</th>
                </tr>
              </thead>
              <tbody>
                {[...s.daily].reverse().map((d) => (
                  <tr key={d.day}>
                    <td>{dayLabel(d.day)}</td>
                    <td>{d.orders}</td>
                    <td>{rub(d.gmv)}</td>
                    <td>{rub(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      <RegistryCard />
    </section>
  );
}
