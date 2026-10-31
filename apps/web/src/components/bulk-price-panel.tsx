'use client';

import { useState } from 'react';
import { repriceError, repriced } from '@gamemarket/shared/reprice';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';
import type { MyLot } from './my-lot-row';

type Reason = 'sale' | 'topup' | 'min' | 'same' | 'unavailable';

interface PriceResult {
  done: number;
  skipped: Array<{ id: string; reason: Reason }>;
}

const QUICK = [-10, -5, 5, 10];

/** «+10» и «−5» → число; «5» — плюс; не число — NaN. */
const pctOf = (v: string) => {
  const s = v.trim().replace('−', '-').replace('%', '');
  return /^[+-]?\d{1,3}$/.test(s) ? Number(s) : NaN;
};
const signed = (p: number) => (p > 0 ? `+${p}%` : `−${Math.abs(p)}%`);
const later = (iso?: string | null) => !!iso && new Date(iso).getTime() > Date.now();

/** Итог правки словами: сколько изменено и почему остальные пропущены. */
function resultNote(r: PriceResult, t: T): string {
  const done = t('Цены изменены: {n}.', { n: r.done });
  if (!r.skipped.length) return done;
  const by = (reason: Reason) => r.skipped.filter((s) => s.reason === reason).length;
  const why = [
    by('sale') && t('идёт скидка — {n}', { n: by('sale') }),
    by('topup') && t('пополнение — {n}', { n: by('topup') }),
    by('min') && t('меньше 1 ₽ — {n}', { n: by('min') }),
    by('same') && t('без изменений — {n}', { n: by('same') }),
    by('unavailable') && t('недоступны — {n}', { n: by('unavailable') }),
  ]
    .filter(Boolean)
    .join(', ');
  return `${done} ${t('Пропустили {n}: {why}.', { n: r.skipped.length, why })}`;
}

/**
 * Цены выбранных лотов разом: дороже или дешевле на столько-то процентов,
 * с превью «было → станет» до нажатия. Лоты со скидкой и пополнения
 * пропускаются — у первых своя прежняя цена, у вторых цена из наценки.
 */
export function BulkPricePanel({
  lots,
  onDone,
  onClose,
}: {
  /** Выбранные лоты. */
  lots: MyLot[];
  onDone: (note: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pct = pctOf(input);
  const problem = input.trim() ? repriceError(pct) : null;
  const ready = !!input.trim() && !problem;
  const eligible = lots.filter(
    (l) => l.topupMarkupBps == null && !later(l.saleUntil) && l.status !== 'blocked',
  );
  const skip = lots.length - eligible.length;

  async function apply() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<PriceResult>('/listings/bulk-price', {
        method: 'POST',
        body: JSON.stringify({ ids: lots.map((l) => l.id), percent: pct }),
      });
      onDone(resultNote(r, t));
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не получилось. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bulk-price">
      <div className="row bulk-price-pick">
        {QUICK.map((p) => (
          <button
            key={p}
            type="button"
            className="chip"
            aria-pressed={ready && pct === p}
            onClick={() => setInput(String(p))}
          >
            {signed(p)}
          </button>
        ))}
        <input
          className="input bulk-price-input"
          inputMode="text"
          value={input}
          maxLength={5}
          placeholder="±%"
          aria-label={t('На сколько процентов изменить цену, например +7 или −5')}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      {problem ? (
        <p className="field-error" style={{ margin: 0 }}>
          {t.d(problem)}
        </p>
      ) : ready ? (
        <ul className="bulk-price-preview">
          {eligible.slice(0, 3).map((l) => (
            <li key={l.id}>
              <span className="bulk-price-title">{l.title}</span>
              <span className="num">
                {formatPrice(l.price, l.currency, t)} →{' '}
                <b>{formatPrice(repriced(BigInt(l.price), pct).toString(), l.currency, t)}</b>
              </span>
            </li>
          ))}
          {eligible.length > 3 && (
            <li className="faint">{t('и ещё {n}', { n: eligible.length - 3 })}</li>
          )}
        </ul>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {t('Цена в целых рублях останется в рублях: 999 ₽ +7% — 1 069 ₽.')}
        </p>
      )}
      {skip > 0 && (
        <p className="hint" style={{ margin: 0 }}>
          {t('Не изменятся {n}: идёт скидка, пополнение или лот заблокирован.', { n: skip })}
        </p>
      )}
      {err && (
        <p className="field-error" role="alert" style={{ margin: 0 }}>
          {err}
        </p>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={busy || !ready || !eligible.length}
          onClick={() => void apply()}
        >
          {ready
            ? t('Изменить цены {pct}: {n}', { pct: signed(pct), n: eligible.length })
            : t('Изменить цены')}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('Отмена')}
        </button>
      </div>
    </div>
  );
}
