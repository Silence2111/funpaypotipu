'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

/** Пополнение баланса: создать депозит → (демо) подтверждение оплаты → обновить баланс. */
export function TopUpForm({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    const rub = parseFloat(amount.replace(',', '.').replace(/\s/g, ''));
    if (!(rub > 0)) {
      setMsg({ ok: false, text: 'Введите сумму в рублях, например 1000' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const dep = await apiFetch<{ providerRef: string }>('/payments/topup', {
        method: 'POST',
        body: JSON.stringify({ amount: String(Math.round(rub * 100)) }),
      });
      await apiFetch(`/payments/mock/callback?providerRef=${dep.providerRef}`, { method: 'POST' });
      setAmount('');
      setMsg({ ok: true, text: `Баланс пополнен на ${rub.toLocaleString('ru-RU')} ₽` });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, 'Не удалось пополнить. Попробуйте ещё раз.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field" style={{ marginTop: 14 }}>
      <label className="label" htmlFor="topup">Пополнить баланс, ₽</label>
      <div className="row" style={{ gap: 8 }}>
        <input id="topup" className="input" placeholder="1000" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 160 }} />
        <button className="btn secondary" onClick={go} disabled={busy} type="button">
          {busy ? 'Пополняем…' : 'Пополнить'}
        </button>
      </div>
      {msg && <p className={msg.ok ? 'hint' : 'field-error'} style={msg.ok ? { color: 'var(--success)' } : undefined}>{msg.text}</p>}
    </div>
  );
}
