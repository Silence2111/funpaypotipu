'use client';

import { useState } from 'react';
import { SALE_DAYS, SALE_MAX_PCT, SALE_MIN_PCT, salePrice, saleOff } from '@gamemarket/shared/sale';
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
 * Идёт скидка — сколько было и сейчас, «Завершить». Панель раскрывается
 * под строкой лота, кнопку рисует сама строка.
 */
export function SalePanel({
  listingId,
  price,
  currency,
  saleListPrice,
  saleUntil,
  onDone,
  onClose,
}: {
  listingId: string;
  price: string;
  currency: string;
  saleListPrice?: string | null;
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
            pct: saleOff(saleListPrice, price) ?? 0,
            date: date(new Date(saleUntil!).getTime(), t),
            was: formatPrice(saleListPrice!, currency, t),
            now: formatPrice(price, currency, t),
          })}
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
        if (!valid) return;
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
      <p style={{ margin: 0, fontSize: 14 }}>
        {valid
          ? t('Станет {now} вместо {was} до {date}.', {
              now: formatPrice(salePrice(BigInt(price), n).toString(), currency, t),
              was: formatPrice(price, currency, t),
              date: date(Date.now() + days * 86_400_000, t),
            })
          : t('Скидка — от {min} до {max}%.', { min: SALE_MIN_PCT, max: SALE_MAX_PCT })}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="btn" disabled={busy || !valid}>
          {t('Начать скидку')}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('Отмена')}
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {t(
          'Покупатели увидят зачёркнутую цену и «−{pct}%». У кого лот в избранном, придёт уведомление. По окончании срока цена вернётся сама.',
          { pct: valid ? n : '…' },
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
