'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

type Scheme = 'escrow' | 'safe_deal';

/**
 * Схема оплаты (часть 123): escrow — деньги на счёте площадки, как было;
 * «Безопасная сделка» — деньги держит ЮKassa на сделке. Переключение
 * действует на новые оплаты: заказ, оплаченный в сделке, доводится через
 * неё. Только администратор, в журнале.
 */
export function PaymentSchemeCard() {
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiFetch<{ scheme: Scheme }>('/admin/payment-scheme')
      .then((r) => setScheme(r.scheme))
      .catch((e) => setMsg({ ok: false, text: apiErrorMessage(e, 'Не удалось загрузить схему оплаты.') }));
  }, []);

  async function set(next: Scheme) {
    if (next === scheme) return;
    const text =
      next === 'safe_deal'
        ? 'Включить «Безопасную сделку» ЮKassa? Новые заказы — только картой, оплата с баланса и пополнение отключатся, продавцам — выплаты по сделкам на карту или ЮMoney.'
        : 'Вернуть схему escrow? Новые оплаты пойдут на счёт площадки; заказы, оплаченные в сделке, доведутся через неё.';
    if (!window.confirm(text)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ scheme: Scheme }>('/admin/payment-scheme', {
        method: 'PUT',
        body: JSON.stringify({ scheme: next }),
      });
      setScheme(r.scheme);
      setMsg({ ok: true, text: r.scheme === 'safe_deal' ? 'Включена «Безопасная сделка».' : 'Включена схема escrow.' });
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, 'Не удалось сменить схему.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
      <h2 className="h2" style={{ fontSize: 18, margin: 0 }}>Схема оплаты</h2>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        «Безопасная сделка» ЮKassa: деньги покупателя держит ЮKassa, продавцу — выплата по сделке после подтверждения,
        возврат — на карту. Нужен договор с ЮKassa на «Безопасную сделку» (часть 107); пока — заглушка.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Схема оплаты">
        {(
          [
            ['escrow', 'Деньги на счёте площадки'],
            ['safe_deal', '«Безопасная сделка» ЮKassa'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className="chip" aria-pressed={scheme === key} disabled={busy || scheme === null} onClick={() => void set(key)}>
            {label}
          </button>
        ))}
      </div>
      {msg && (
        <div className={msg.ok ? 'alert success' : 'alert error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </div>
      )}
    </section>
  );
}
