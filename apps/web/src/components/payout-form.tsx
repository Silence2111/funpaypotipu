'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/session';

/** Заявка на вывод средств с баланса. */
export function PayoutForm({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    const rub = parseFloat(amount.replace(',', '.'));
    if (!(rub > 0) || dest.trim().length < 4) {
      setMsg('Укажите сумму и реквизиты');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/payouts', {
        method: 'POST',
        body: JSON.stringify({
          amount: String(Math.round(rub * 100)),
          method: 'card',
          destination: dest.trim(),
        }),
      });
      setMsg('Заявка на вывод создана');
      setAmount('');
      setDest('');
      onDone();
    } catch {
      setMsg('Не удалось создать заявку (недостаточно средств?)');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="input" placeholder="Сумма вывода, ₽" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 150 }} />
        <input className="input" placeholder="Карта / реквизиты" value={dest}
          onChange={(e) => setDest(e.target.value)} style={{ maxWidth: 190 }} />
        <button className="chip" onClick={go} disabled={busy} type="button">Вывести</button>
      </div>
      {msg && <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>{msg}</p>}
    </div>
  );
}
