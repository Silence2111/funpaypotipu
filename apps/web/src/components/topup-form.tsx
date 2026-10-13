'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { PayMethods, priceFor, type PayMethod } from '@/components/pay-methods';

/**
 * Пополнение баланса: сумма и способ оплаты → депозит → (демо) подтверждение
 * оплаты → обновить баланс. На баланс приходит введённая сумма, шлюз берёт её
 * плюс комиссию способа — обе цифры видны до нажатия.
 */
export function TopUpForm({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('sbp');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rub = parseFloat(amount.replace(',', '.').replace(/\s/g, ''));
  const minor = rub > 0 ? BigInt(Math.round(rub * 100)) : null;
  const charge = minor != null ? priceFor(minor, method) : null;

  async function go() {
    if (minor == null) {
      setMsg({ ok: false, text: 'Введите сумму в рублях, например 1000' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const dep = await apiFetch<{ providerRef: string }>('/payments/topup', {
        method: 'POST',
        body: JSON.stringify({ amount: minor.toString(), method }),
      });
      await apiFetch(`/payments/mock/callback?providerRef=${dep.providerRef}`, { method: 'POST' });
      setAmount('');
      setMsg({ ok: true, text: `Баланс пополнен на ${formatPrice(minor.toString())}` });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, 'Не удалось пополнить. Попробуйте ещё раз.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-form" style={{ marginTop: 14, gap: 12 }}>
      <div className="field">
        <label className="label" htmlFor="topup">Пополнить баланс, ₽</label>
        <input id="topup" className="input" placeholder="1000" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 200 }} />
      </div>
      <PayMethods id="topup-method" base={minor} currency="RUB" value={method} onChange={setMethod}
        variant="select" withBalance={false} />
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <button className="btn secondary" onClick={go} disabled={busy} type="button">
          {busy ? 'Пополняем…' : charge != null ? `Оплатить ${formatPrice(charge.toString())}` : 'Пополнить'}
        </button>
        {minor != null && charge != null && charge !== minor && (
          <span className="hint">На баланс придёт {formatPrice(minor.toString())}</span>
        )}
      </div>
      {msg && <p className={msg.ok ? 'hint' : 'field-error'} style={msg.ok ? { color: 'var(--success)' } : undefined}>{msg.text}</p>}
    </div>
  );
}
