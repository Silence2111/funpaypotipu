'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';

/** Оформление заказа: create (+ промокод) → deposit → (mock) оплата → страница заказа. */
export function BuyButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [promo, setPromo] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function buy() {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const order = await apiFetch<{ id: string }>('/orders', {
        method: 'POST',
        body: JSON.stringify({ listingId, ...(promo.trim() ? { promoCode: promo.trim() } : {}) }),
      });
      const dep = await apiFetch<{ providerRef: string }>('/payments/deposit', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id }),
      });
      await apiFetch(`/payments/mock/callback?providerRef=${dep.providerRef}`, { method: 'POST' });
      router.push(`/orders/${order.id}`);
    } catch {
      setErr('Не удалось оформить заказ');
      setBusy(false);
    }
  }

  return (
    <>
      <input
        className="input"
        placeholder="Промокод (необязательно)"
        value={promo}
        onChange={(e) => setPromo(e.target.value)}
        style={{ marginBottom: 10 }}
      />
      <button className="btn" style={{ width: '100%' }} onClick={buy} disabled={busy} type="button">
        {busy ? 'Оформляем…' : 'Купить'}
      </button>
      {err && <p style={{ color: '#d33', fontSize: 13, marginTop: 8 }}>{err}</p>}
    </>
  );
}
