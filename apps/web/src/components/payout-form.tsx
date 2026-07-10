'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

interface Method {
  key: string;
  label: string;
  feePct: number;
  minFee: string;
  minAmount: string;
  maxAmount: string;
}

/** Заявка на вывод средств: выбор способа + живое превью «на руки». */
export function PayoutForm({ onDone }: { onDone: () => void }) {
  const [methods, setMethods] = useState<Method[]>([]);
  const [methodKey, setMethodKey] = useState('');
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Method[]>('/payouts/methods')
      .then((m) => { setMethods(m ?? []); setMethodKey(m?.[0]?.key ?? ''); })
      .catch(() => {});
  }, []);

  const method = methods.find((m) => m.key === methodKey);
  const rub = parseFloat(amount.replace(',', '.'));
  const grossMinor = rub > 0 ? Math.round(rub * 100) : 0;
  const fee = method && grossMinor > 0
    ? Math.max(Math.floor(grossMinor * method.feePct), Number(method.minFee))
    : 0;
  const net = Math.max(0, grossMinor - fee);
  const belowMin = method && grossMinor > 0 && grossMinor < Number(method.minAmount);

  async function go() {
    if (!method) return;
    if (!(rub > 0) || dest.trim().length < 4) { setMsg('Укажите сумму и реквизиты'); return; }
    if (belowMin) { setMsg(`Минимум для «${method.label}» — ${Number(method.minAmount) / 100} ₽`); return; }
    setBusy(true); setMsg(null);
    try {
      await apiFetch('/payouts', {
        method: 'POST',
        body: JSON.stringify({ amount: String(grossMinor), method: method.key, destination: dest.trim() }),
      });
      setMsg('Заявка на вывод создана'); setAmount(''); setDest(''); onDone();
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const m = raw.match(/"message":"([^"]+)"/);
      setMsg(m?.[1] ?? 'Не удалось создать заявку');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="input" value={methodKey} onChange={(e) => setMethodKey(e.target.value)}
          style={{ maxWidth: 170 }}>
          {methods.map((m) => (
            <option key={m.key} value={m.key}>{m.label} · {Math.round(m.feePct * 100)}%</option>
          ))}
        </select>
        <input className="input" placeholder="Сумма, ₽" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 130 }} />
        <input className="input" placeholder="Карта / реквизиты" value={dest}
          onChange={(e) => setDest(e.target.value)} style={{ maxWidth: 180 }} />
        <button className="chip" onClick={go} disabled={busy} type="button">Вывести</button>
      </div>

      {method && grossMinor > 0 && !belowMin && (
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginTop: 8, maxWidth: 300 }}>
          <span className="faint">Комиссия {(fee / 100).toLocaleString('ru-RU')} ₽</span>
          <span style={{ fontWeight: 600, color: '#1a7f37' }}>на руки {(net / 100).toLocaleString('ru-RU')} ₽</span>
        </div>
      )}
      {msg && <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>{msg}</p>}
    </div>
  );
}
