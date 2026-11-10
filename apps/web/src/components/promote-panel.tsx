'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';

const DAYS = [1, 3, 7] as const;
const dayWord = (d: number, t: T) => (d === 1 ? t('сутки') : t('{n} суток', { n: d }));
const until = (iso: string, t: T) =>
  new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/**
 * «Продвинуть» в «Моих лотах»: лот выше в своём разделе на оплаченный
 * срок, оплата с баланса. Продление добавляется к оставшемуся сроку.
 * Панель раскрывается под строкой лота, кнопку рисует сама строка.
 */
export function PromotePanel({
  listingId,
  promotedUntil,
  onDone,
  onClose,
}: {
  listingId: string;
  promotedUntil?: string | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [dayPrice, setDayPrice] = useState<bigint | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = !!promotedUntil && new Date(promotedUntil).getTime() > Date.now();

  useEffect(() => {
    apiFetch<{ promoDayPrice?: string }>('/fees/public')
      .then((p) => setDayPrice(BigInt(p.promoDayPrice ?? '0')))
      .catch(() => {});
    apiFetch<{ balance: string }>('/wallet')
      .then((w) => setBalance(BigInt(w.balance)))
      .catch(() => {});
  }, []);

  async function buy(days: number) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/listings/${listingId}/promote`, { method: 'POST', body: JSON.stringify({ days }) });
      onClose();
      onDone();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось продвинуть лот.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flat" style={{ padding: 14, background: 'var(--page)' }}>
      <p style={{ margin: 0, fontSize: 14 }}>
        {active
          ? t('В продвижении до {date}. Продление добавится к сроку.', { date: until(promotedUntil!, t) })
          : t('Лот будет выше в своём разделе каталога.')}
      </p>
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {DAYS.map((d) => {
          const cost = dayPrice != null ? dayPrice * BigInt(d) : null;
          const short = cost != null && balance != null && balance < cost;
          return (
            <button key={d} type="button" className="chip" disabled={busy || cost == null || short} onClick={() => void buy(d)}>
              {dayWord(d, t)}
              {cost != null ? ` · ${formatPrice(cost.toString(), 'RUB', t)}` : ''}
            </button>
          );
        })}
        <button type="button" className="btn ghost" onClick={onClose}>{t('Отмена')}</button>
      </div>
      <p className="hint" style={{ margin: '8px 0 0' }}>
        {balance != null
          ? t('Оплата с баланса · на балансе {sum}.', { sum: formatPrice(balance.toString(), 'RUB', t) })
          : t('Оплата с баланса.')}{' '}
        {t('Покупатели видят пометку «продвижение».')}
      </p>
      {err && <p className="field-error" role="alert" style={{ marginTop: 6 }}>{err}</p>}
    </div>
  );
}
