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
    </section>
  );
}
