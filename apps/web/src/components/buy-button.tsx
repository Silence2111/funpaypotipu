'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { qtyError, qtyTotal } from '@gamemarket/shared/quantity';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { payOrder } from '@/lib/checkout';
import { formatPrice, formatQty } from '@/lib/format';

/** Условия поштучного лота: покупатель выбирает количество, сумма — за него. */
export interface QtyOffer {
  price: string;
  currency: string;
  unitName: string | null;
  pricePerUnits: number;
  minQty: number;
  stock: number | null;
}

/** «25 000», «25000», «25 000» → 25000; не число — NaN. */
const parseQty = (v: string) => (/^\d[\d\s\u00a0\u202f]*$/.test(v.trim()) ? Number(v.replace(/\D/g, '')) : NaN);

/** Оформление заказа: create (+ промокод, +UID для пополнений, +количество) → deposit → оплата → заказ. */
export function BuyButton({
  listingId,
  fulfillmentType,
  qtyOffer,
}: {
  listingId: string;
  fulfillmentType?: string;
  qtyOffer?: QtyOffer;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [promo, setPromo] = useState('');
  const [account, setAccount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [qtyInput, setQtyInput] = useState(qtyOffer ? String(qtyOffer.minQty) : '1');
  const [err, setErr] = useState<string | null>(null);

  const isTopUp = fulfillmentType === 'provider';
  const qty = parseQty(qtyInput);
  const qtyProblem = qtyOffer ? qtyError(qty, qtyOffer) : null;
  const total = qtyOffer && !qtyProblem ? qtyTotal(BigInt(qtyOffer.price), qtyOffer.pricePerUnits, qty) : null;
  const canBuy = (!isTopUp || (account.trim().length > 0 && confirmed)) && !qtyProblem;

  async function createOrder() {
    const order = await apiFetch<{ id: string }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        listingId,
        ...(promo.trim() ? { promoCode: promo.trim() } : {}),
        ...(isTopUp && account.trim() ? { account: account.trim() } : {}),
        ...(qtyOffer ? { qty } : {}),
      }),
    });
    return order.id;
  }

  const blocker = () => qtyProblem ?? 'Укажите игровой ID и отметьте, что он верный';

  async function buy() {
    if (!getToken()) return router.push(`/register?next=${encodeURIComponent(`/lot/${listingId}`)}`);
    if (!canBuy) { setErr(blocker()); return; }
    setBusy(true);
    setErr(null);
    try {
      const orderId = await createOrder();
      await payOrder(orderId, 'gateway');
      router.push(`/orders/${orderId}`);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось оформить заказ. Обновите страницу и попробуйте ещё раз.'));
      setBusy(false);
    }
  }

  async function buyFromBalance() {
    if (!getToken()) return router.push(`/login?next=${encodeURIComponent(`/lot/${listingId}`)}`);
    if (!canBuy) { setErr(blocker()); return; }
    setBusy(true);
    setErr(null);
    try {
      const orderId = await createOrder();
      await payOrder(orderId, 'balance');
      router.push(`/orders/${orderId}`);
    } catch (e) {
      setErr(apiErrorMessage(e, 'На балансе не хватает денег. Оплатите заказ обычным способом.'));
      setBusy(false);
    }
  }

  return (
    <>
      {qtyOffer && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label" htmlFor="buy-qty">
            Количество{qtyOffer.unitName ? `, ${qtyOffer.unitName}` : ''}
          </label>
          <input id="buy-qty" className="input" inputMode="numeric" autoComplete="off" value={qtyInput}
            onChange={(e) => { setQtyInput(e.target.value); setErr(null); }}
            aria-invalid={!!qtyProblem} aria-describedby="buy-qty-note" />
          {qtyProblem && qtyInput.trim() ? (
            <p className="field-error" id="buy-qty-note">{qtyProblem}</p>
          ) : (
            <p className="hint" id="buy-qty-note">
              {qtyOffer.minQty > 1 ? `От ${formatQty(qtyOffer.minQty, qtyOffer.unitName)}` : 'От 1'}
              {qtyOffer.stock != null ? ` · в наличии ${formatQty(qtyOffer.stock, qtyOffer.unitName)}` : ''}
            </p>
          )}
        </div>
      )}

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
        {busy ? 'Оформляем заказ…' : total != null ? `Купить за ${formatPrice(total.toString(), qtyOffer!.currency)}` : 'Купить'}
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
