'use client';

import { useState } from 'react';
import { priceSummary, type PricePoint } from '@gamemarket/shared/price-history';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';

const DAY = 86_400_000;
const dayMonth = (iso: string | number, t: T) =>
  new Date(iso).toLocaleDateString(t.locale, { day: 'numeric', month: 'long' });
const dateTime = (iso: string, t: T) =>
  new Date(iso).toLocaleString(t.locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * «История цены» за 30 дней: ступенчатая линия — цена держится до
 * следующего изменения. Наведение или фокус на отрезке — цена и с какого по
 * какое число; под графиком — сейчас, минимум и максимум, ниже — все
 * изменения таблицей. Цена не менялась — одна строка без графика.
 *
 * `now` приходит с сервера: время рендера на сервере и в браузере иначе
 * разошлось бы, и разметка не совпала бы при гидратации.
 */
export function PriceHistory({
  points,
  days,
  currency,
  pack,
  now,
}: {
  points: PricePoint[];
  days: number;
  currency: string;
  /** «за 1 000 золота» — у поштучного лота. */
  pack?: string | null;
  now: number;
}) {
  const t = useT();
  const [active, setActive] = useState<number | null>(null);
  const summary = priceSummary(points);
  if (!summary) return null;
  const price = (minor: string) => `${formatPrice(minor, currency, t)}${pack ? ` ${pack}` : ''}`;
  const t0 = now - days * DAY;

  if (points.length === 1) {
    const since = new Date(points[0]!.at).getTime();
    return (
      <p className="muted" style={{ margin: 0 }}>
        {since - t0 > DAY
          ? t('Цена не менялась с {date} — {price}.', {
              date: dayMonth(since, t),
              price: price(summary.current),
            })
          : t('Цена не менялась последние {n} дней — {price}.', {
              n: days,
              price: price(summary.current),
            })}
      </p>
    );
  }

  const x = (iso: string) => Math.min(1, Math.max(0, (new Date(iso).getTime() - t0) / (now - t0)));
  const lo = Number(summary.min.price);
  const hi = Number(summary.max.price);
  const pad = (hi - lo) * 0.15 || hi * 0.1;
  const y = (minor: string) => 1 - (Number(minor) - (lo - pad)) / (hi + pad - (lo - pad));
  const segments = points.map((p, i) => ({
    ...p,
    from: x(p.at),
    to: i + 1 < points.length ? x(points[i + 1]!.at) : 1,
    y: y(p.price),
  }));
  const path = segments
    .map((s, i) =>
      i === 0
        ? `M ${s.from * 1000} ${s.y * 100} H ${s.to * 1000}`
        : `V ${s.y * 100} H ${s.to * 1000}`,
    )
    .join(' ');
  const hover = active === null ? null : segments[active]!;

  return (
    <div className="price-history">
      <div className="price-chart">
        <div className="daily-scale price-scale" aria-hidden>
          <span>{formatPrice(summary.max.price, currency, t)}</span>
          <span>{formatPrice(summary.min.price, currency, t)}</span>
        </div>
        <div className="price-plot" onMouseLeave={() => setActive(null)}>
          <div className="price-area">
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
              <path d={path} className="price-line" vectorEffect="non-scaling-stroke" />
            </svg>
            {hover && (
              <span className="price-cross" style={{ left: `${hover.from * 100}%` }} aria-hidden />
            )}
            {segments.map((s, i) => (
              <span
                key={`dot-${i}`}
                className="price-dot"
                data-active={active === i ? 'true' : undefined}
                style={{
                  left: `${(i === segments.length - 1 ? s.to : s.from) * 100}%`,
                  top: `${s.y * 100}%`,
                }}
                aria-hidden
              />
            ))}
            {segments.map((s, i) => (
              <button
                key={`hit-${i}`}
                type="button"
                className="price-hit"
                style={{
                  left: `${s.from * 100}%`,
                  width: `${Math.max(s.to - s.from, 0.01) * 100}%`,
                }}
                aria-label={t('{price} с {from} по {to}', {
                  price: price(s.price),
                  from: dayMonth(s.at, t),
                  to: i + 1 < segments.length ? dayMonth(segments[i + 1]!.at, t) : t('сегодня'),
                })}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            ))}
            {hover && active !== null && (
              <div
                className="daily-tip"
                role="status"
                style={(() => {
                  const at = (hover.from + hover.to) / 2;
                  const shift = at < 0.2 ? '0%' : at > 0.8 ? '-100%' : '-50%';
                  return { left: `${at * 100}%`, transform: `translate(${shift}, -100%)` };
                })()}
              >
                <b>{price(hover.price)}</b>
                <span>
                  {active + 1 < segments.length
                    ? t('с {from} по {to}', {
                        from: dayMonth(hover.at, t),
                        to: dayMonth(segments[active + 1]!.at, t),
                      })
                    : t('с {from} — сейчас', { from: dayMonth(hover.at, t) })}
                </span>
              </div>
            )}
          </div>
          <div className="daily-axis" aria-hidden>
            <span>{dayMonth(t0, t)}</span>
            <span>{t('сегодня')}</span>
          </div>
        </div>
      </div>
      <p className="price-summary">
        <span>
          {t('Сейчас')} <b className="num">{price(summary.current)}</b>
        </span>
        <span>
          {t('минимум')} <b className="num">{formatPrice(summary.min.price, currency, t)}</b>
          <span className="faint"> · {dayMonth(summary.min.at, t)}</span>
        </span>
        <span>
          {t('максимум')} <b className="num">{formatPrice(summary.max.price, currency, t)}</b>
          <span className="faint"> · {dayMonth(summary.max.at, t)}</span>
        </span>
      </p>
      <details className="price-table">
        <summary className="faint">{t('Все изменения: {n}', { n: summary.changes })}</summary>
        <table className="stats-table">
          <thead>
            <tr>
              <th scope="col">{t('Когда')}</th>
              <th scope="col">{t('Цена')}</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={`${p.at}-${p.price}`}>
                <td>{dateTime(p.at, t)}</td>
                <td className="num">{price(p.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
