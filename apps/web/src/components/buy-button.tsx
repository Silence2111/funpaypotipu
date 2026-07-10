'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';

/** Оформление заказа: create (+ промокод, +UID для пополнений) → deposit → оплата → заказ. */
export function BuyButton({ listingId, fulfillmentType }: { listingId: string; fulfillmentType?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [promo, setPromo] = useState('');
  const [account, setAccount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isTopUp = fulfillmentType === 'provider';
  const canBuy = !isTopUp || (account.trim().length > 0 && confirmed);

  async function createOrder() {
    const order = await apiFetch<{ id: string }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        listingId,
        ...(promo.trim() ? { promoCode: promo.trim() } : {}),
        ...(isTopUp && account.trim() ? { account: account.trim() } : {}),
      }),
    });
    return order.id;
  }

  async function buy() {
    if (!getToken()) return router.push('/login');
    if (!canBuy) { setErr('Укажите игровой ID/логин и подтвердите'); return; }
    setBusy(true);
    setErr(null);
    try {
      const orderId = await createOrder();
      const dep = await apiFetch<{ providerRef: string }>('/payments/deposit', {
        method: 'POST',
        body: JSON.stringify({ orderId }),
      });
      await apiFetch(`/payments/mock/callback?providerRef=${dep.providerRef}`, { method: 'POST' });
      router.push(`/orders/${orderId}`);
    } catch {
      setErr('Не удалось оформить заказ');
      setBusy(false);
    }
  }

  async function buyFromBalance() {
    if (!getToken()) return router.push('/login');
    if (!canBuy) { setErr('Укажите игровой ID/логин и подтвердите'); return; }
    setBusy(true);
    setErr(null);
    try {
      const orderId = await createOrder();
      await apiFetch(`/orders/${orderId}/pay-from-balance`, { method: 'POST' });
      router.push(`/orders/${orderId}`);
    } catch {
      setErr('Недостаточно средств на балансе или ошибка');
      setBusy(false);
    }
  }

  return (
    <>
      {isTopUp && (
        <div style={{ marginBottom: 10 }}>
          <input className="input" placeholder="Игровой ID / логин" value={account}
            onChange={(e) => setAccount(e.target.value)} />
          <label className="row muted" style={{ gap: 8, fontSize: 12.5, marginTop: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: 2 }} />
            <span>Я указал верный ID — пополнение придёт на этот аккаунт, возврат при ошибке в ID невозможен</span>
          </label>
        </div>
      )}

      <input className="input" placeholder="Промокод (необязательно)" value={promo}
        onChange={(e) => setPromo(e.target.value)} style={{ marginBottom: 10 }} />

      <button className="btn" style={{ width: '100%' }} onClick={buy} disabled={busy || !canBuy} type="button">
        {busy ? 'Оформляем…' : 'Купить'}
      </button>
      <button className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={buyFromBalance}
        disabled={busy || !canBuy} type="button">
        Оплатить с баланса
      </button>
      {err && <p style={{ color: '#d33', fontSize: 13, marginTop: 8 }}>{err}</p>}
    </>
  );
}
