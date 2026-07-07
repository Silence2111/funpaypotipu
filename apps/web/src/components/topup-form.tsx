'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/session';

/** Пополнение баланса: создать депозит → (демо) подтверждение оплаты → обновить баланс. */
export function TopUpForm({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    const rub = parseFloat(amount.replace(',', '.'));
    if (!(rub > 0)) return;
    setBusy(true);
    try {
      const dep = await apiFetch<{ providerRef: string }>('/payments/topup', {
        method: 'POST',
        body: JSON.stringify({ amount: String(Math.round(rub * 100)) }),
      });
      await apiFetch(`/payments/mock/callback?providerRef=${dep.providerRef}`, { method: 'POST' });
      setAmount('');
      onDone();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <input
        className="input"
        placeholder="Сумма, ₽"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{ maxWidth: 140 }}
      />
      <button className="btn" onClick={go} disabled={busy} type="button">
        {busy ? '…' : 'Пополнить'}
      </button>
    </div>
  );
}
