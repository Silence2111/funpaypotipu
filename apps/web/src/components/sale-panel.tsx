'use client';

import { useEffect, useState } from 'react';
import {
  SALE_DAYS,
  SALE_MAX_PCT,
  SALE_MIN_PCT,
  SALE_REF_DAYS,
  salePrice,
  saleOff,
  saleReference,
} from '@gamemarket/shared/sale';
import type { PriceHistory } from '@/lib/api';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';

const QUICK = [10, 15, 20, 30];
const dayWord = (d: number, t: T) => (d === 1 ? t('сутки') : t('{n} суток', { n: d }));
const date = (ms: number, t: T) =>
  new Date(ms).toLocaleDateString(t.locale, { day: 'numeric', month: 'long' });

/**
 * «Скидка» в «Моих лотах»: процент и срок, сколько станет — до нажатия.
 * Скидка честная: покупатель видит её от самой низкой цены за неделю до
 * неё, и панель показывает это заранее — по истории цены лота. Идёт
 * скидка — сколько сейчас и что вернётся, «Завершить». Панель раскрывается
 * под строкой лота, кнопку рисует сама строка.
 */
export function SalePanel({
  listingId,
  price,
  currency,
  saleListPrice,
  saleRefPrice,
  saleUntil,
  onDone,
  onClose,
}: {
  listingId: string;
  price: string;
  currency: string;
  saleListPrice?: string | null;
  /** От чего скидку видят покупатели; у скидок до этого правила — нет. */
  saleRefPrice?: string | null;
  saleUntil?: string | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [pct, setPct] = useState('10');
  const [days, setDays] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const running = !!saleListPrice && !!saleUntil;
  const n = Number(pct);
  const valid = Number.isInteger(n) && n >= SALE_MIN_PCT && n <= SALE_MAX_PCT;
  // Самая низкая цена за неделю — по истории; пока её нет, нынешняя.
  const [ref, setRef] = useState<bigint>(BigInt(price));
  useEffect(() => {
    if (running) return;
    apiFetch<PriceHistory>(`/listings/${listingId}/price-history`)
      .then((h) => setRef(saleReference(h.points, BigInt(price), Date.now())))
      .catch(() => undefined);
  }, [listingId, price, running]);
  const next = valid ? salePrice(BigInt(price), n) : null;
  const shown = next != null ? (saleOff(ref, next) ?? 0) : 0;
  const honest = shown >= SALE_MIN_PCT;
  const raised = ref < BigInt(price);

  async function call(path: string, init: RequestInit, fallback: string) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(path, init);
      onClose();
      onDone();
    } catch (e) {
      setErr(apiErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  if (running) {
    return (
      <div className="card flat sale-panel">
        <p style={{ margin: 0, fontSize: 14 }}>
          {t('Скидка −{pct}% до {date}: было {was}, сейчас {now}.', {
            pct: saleOff(saleRefPrice ?? saleListPrice, price) ?? 0,
            date: date(new Date(saleUntil!).getTime(), t),
            was: formatPrice(saleRefPrice ?? saleListPrice!, currency, t),
            now: formatPrice(price, currency, t),
          })}
          {saleRefPrice && saleRefPrice !== saleListPrice && (
            <>
              {' '}
              {t('После скидки вернётся {list}.', {
                list: formatPrice(saleListPrice!, currency, t),
              })}
            </>
          )}
        </p>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() =>
              void call(
                `/listings/${listingId}/sale`,
                { method: 'DELETE' },
                t('Не удалось завершить скидку.'),
              )
            }
          >
            {t('Завершить скидку')}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('Отмена')}
          </button>
        </div>
        {err && (
          <p className="field-error" role="alert" style={{ marginTop: 6 }}>
            {err}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="card flat sale-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || !honest) return;
        void call(
          `/listings/${listingId}/sale`,
          { method: 'POST', body: JSON.stringify({ percent: n, days }) },
          t('Не удалось начать скидку.'),
        );
      }}
    >
      <div className="sale-row">
        <span className="label">{t('Скидка')}</span>
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            className="chip"
            aria-pressed={pct === String(q)}
            onClick={() => setPct(String(q))}
          >
            {q}%
          </button>
        ))}
        <label className="sale-pct">
          <input
            className="input"
            inputMode="numeric"
            value={pct}
            maxLength={2}
            aria-label={t('Скидка, %')}
            onChange={(e) => setPct(e.target.value.replace(/\D/g, ''))}
          />
          %
        </label>
      </div>
      <div className="sale-row">
        <span className="label">{t('Срок')}</span>
        {SALE_DAYS.map((d) => (
          <button
            key={d}
            type="button"
            className="chip"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
          >
            {dayWord(d, t)}
          </button>
        ))}
      </div>
      {raised && (
        <p className="hint" style={{ margin: 0 }}>
          {t(
            'За {n} дней до скидки цена была ниже — {ref}. Покупатели увидят скидку от неё: поднять цену накануне и зачеркнуть её не выйдет.',
            { n: SALE_REF_DAYS, ref: formatPrice(ref.toString(), currency, t) },
          )}
        </p>
      )}
      <p
        style={{ margin: 0, fontSize: 14 }}
        className={valid && !honest ? 'field-error' : undefined}
      >
        {!valid
          ? t('Скидка — от {min} до {max}%.', { min: SALE_MIN_PCT, max: SALE_MAX_PCT })
          : honest
            ? t('Станет {now} вместо {was} до {date}.', {
                now: formatPrice(next!.toString(), currency, t),
                was: formatPrice(ref.toString(), currency, t),
                date: date(Date.now() + days * 86_400_000, t),
              })
            : t('От {ref} это скидка {off}% — нужно от {min}%. Дайте скидку больше.', {
                ref: formatPrice(ref.toString(), currency, t),
                off: shown,
                min: SALE_MIN_PCT,
              })}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="btn" disabled={busy || !valid || !honest}>
          {t('Начать скидку')}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('Отмена')}
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {t(
          'Покупатели увидят зачёркнутую цену и «−{pct}%». У кого лот в избранном, придёт уведомление. По окончании срока цена вернётся сама.',
          { pct: valid && honest ? shown : '…' },
        )}
      </p>
      {err && (
        <p className="field-error" role="alert">
          {err}
        </p>
      )}
    </form>
  );
}
