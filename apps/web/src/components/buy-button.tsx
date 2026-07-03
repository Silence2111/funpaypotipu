'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';

/** Оформление заказа: create → deposit → (mock) оплата → страница заказа. */
export function BuyButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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
        body: JSON.stringify({ listingId }),
      });
      const dep = await apiFetch<{ providerRef: string }>('/payments/deposit', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id }),
      });
      // Демо: имитируем подтверждение оплаты провайдером (в проде — редирект на оплату).
      await apiFetch(`/payments/mock/callback?providerRef=${dep.providerRef}`, { method: 'POST' });
      router.push(`/orders/${order.id}`);
    } catch {
      setErr('Не удалось оформить заказ');
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn" style={{ width: '100%' }} onClick={buy} disabled={busy} type="button">
        {busy ? 'Оформляем…' : 'Купить'}
      </button>
      {err && <p style={{ color: '#d33', fontSize: 13, marginTop: 8 }}>{err}</p>}
    </>
  );
}
