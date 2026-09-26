'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

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
    if (!getToken()) return router.push(`/register?next=${encodeURIComponent(`/lot/${listingId}`)}`);
    if (!canBuy) { setErr('Укажите игровой ID и отметьте, что он верный'); return; }
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
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось оформить заказ. Обновите страницу и попробуйте ещё раз.'));
      setBusy(false);
    }
  }

  async function buyFromBalance() {
    if (!getToken()) return router.push(`/login?next=${encodeURIComponent(`/lot/${listingId}`)}`);
    if (!canBuy) { setErr('Укажите игровой ID и отметьте, что он верный'); return; }
    setBusy(true);
    setErr(null);
    try {
      const orderId = await createOrder();
      await apiFetch(`/orders/${orderId}/pay-from-balance`, { method: 'POST' });
      router.push(`/orders/${orderId}`);
    } catch (e) {
      setErr(apiErrorMessage(e, 'На балансе не хватает денег. Оплатите заказ обычным способом.'));
      setBusy(false);
    }
  }

  return (
    <>
      {isTopUp && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label" htmlFor="topup-account">Игровой ID или логин</label>
          <input id="topup-account" className="input" placeholder="Например, 812345678" value={account}
            onChange={(e) => setAccount(e.target.value)} />
          <label className="row muted" style={{ gap: 10, fontSize: 13, marginTop: 6, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: 2, width: 18, height: 18, accentColor: 'var(--accent)' }} />
            <span>ID верный. Пополнение придёт на этот аккаунт, при ошибке в ID вернуть его нельзя</span>
          </label>
        </div>
      )}

      <details style={{ marginBottom: 12 }}>
        <summary className="faint" style={{ fontSize: 13, cursor: 'pointer', minHeight: 32 }}>Есть промокод?</summary>
        <div className="field" style={{ marginTop: 8 }}>
          <label className="label" htmlFor="promo" style={{ fontSize: 13 }}>Промокод</label>
          <input id="promo" className="input" placeholder="Например, START10" value={promo}
            onChange={(e) => setPromo(e.target.value)} />
        </div>
      </details>

      <button className="btn block lg" onClick={buy} disabled={busy || !canBuy} type="button">
        {busy ? 'Оформляем заказ…' : 'Купить'}
      </button>
      <button className="btn ghost block" style={{ marginTop: 8 }} onClick={buyFromBalance}
        disabled={busy || !canBuy} type="button">
        Оплатить с баланса
      </button>
      {err && (
        <p className="field-error" role="alert" style={{ marginTop: 10, textAlign: 'center' }}>{err}</p>
      )}
    </>
  );
}
