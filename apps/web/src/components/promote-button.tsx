'use client';

import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';

const DAYS = [1, 3, 7] as const;
const dayWord = (d: number) => (d === 1 ? 'сутки' : `${d} суток`);
const until = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/**
 * «Продвинуть» в «Моих лотах»: лот выше в своём разделе на оплаченный
 * срок, оплата с баланса. Продление добавляется к оставшемуся сроку.
 */
export function PromoteButton({
  listingId,
  promotedUntil,
  onDone,
}: {
  listingId: string;
  promotedUntil?: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dayPrice, setDayPrice] = useState<bigint | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = !!promotedUntil && new Date(promotedUntil).getTime() > Date.now();

  useEffect(() => {
    if (!open) return;
    apiFetch<{ promoDayPrice?: string }>('/fees/public')
      .then((p) => setDayPrice(BigInt(p.promoDayPrice ?? '0')))
      .catch(() => {});
    apiFetch<{ balance: string }>('/wallet')
      .then((w) => setBalance(BigInt(w.balance)))
      .catch(() => {});
  }, [open]);

  async function buy(days: number) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/listings/${listingId}/promote`, { method: 'POST', body: JSON.stringify({ days }) });
      setOpen(false);
      onDone();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось продвинуть лот.'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="chip" onClick={() => setOpen(true)}
        title={active ? `В продвижении до ${until(promotedUntil!)}` : undefined}>
        <TrendingUp size={14} strokeWidth={1.75} /> {active ? 'Продлить продвижение' : 'Продвинуть'}
      </button>
    );
  }

  return (
    <div className="card flat" style={{ padding: 14, background: 'var(--page)', flexBasis: '100%' }}>
      <p style={{ margin: 0, fontSize: 14 }}>
        {active ? `В продвижении до ${until(promotedUntil!)}. Продление добавится к сроку.` : 'Лот будет выше в своём разделе каталога.'}
      </p>
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {DAYS.map((d) => {
          const cost = dayPrice != null ? dayPrice * BigInt(d) : null;
          const short = cost != null && balance != null && balance < cost;
          return (
            <button key={d} type="button" className="chip" disabled={busy || cost == null || short} onClick={() => void buy(d)}>
              {dayWord(d)}{cost != null ? ` · ${formatPrice(cost.toString())}` : ''}
            </button>
          );
        })}
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Отмена</button>
      </div>
      <p className="hint" style={{ margin: '8px 0 0' }}>
        Оплата с баланса{balance != null ? ` · на балансе ${formatPrice(balance.toString())}` : ''}. Покупатели видят пометку
        «продвижение».
      </p>
      {err && <p className="field-error" role="alert" style={{ marginTop: 6 }}>{err}</p>}
    </div>
  );
}
