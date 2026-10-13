'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { qtyError, qtyTotal } from '@gamemarket/shared/quantity';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { payOrder } from '@/lib/checkout';
import { formatPrice, formatQty } from '@/lib/format';
import { PayMethods, priceFor, type PayMethod } from '@/components/pay-methods';

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

/**
 * Оформление заказа: количество, промокод, UID для пополнений, способ оплаты
 * с ценой по нему → заказ → оплата выбранным способом → страница заказа.
 */
export function BuyButton({
  listingId,
  fulfillmentType,
  price,
  currency,
  qtyOffer,
}: {
  listingId: string;
  fulfillmentType?: string;
  /** Цена лота целиком; у поштучного сумма считается из количества. */
  price: string;
  currency: string;
  qtyOffer?: QtyOffer;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [promo, setPromo] = useState('');
  const [account, setAccount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [qtyInput, setQtyInput] = useState(qtyOffer ? String(qtyOffer.minQty) : '1');
  const [method, setMethod] = useState<PayMethod>('sbp');
  const [err, setErr] = useState<string | null>(null);

  const isTopUp = fulfillmentType === 'provider';
  const qty = parseQty(qtyInput);
  const qtyProblem = qtyOffer ? qtyError(qty, qtyOffer) : null;
  const base = qtyOffer
    ? qtyProblem
      ? null
      : qtyTotal(BigInt(qtyOffer.price), qtyOffer.pricePerUnits, qty)
    : BigInt(price);
  const toPay = base != null ? priceFor(base, method) : null;
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

  async function buy() {
    if (!getToken()) {
      const page = method === 'balance' ? 'login' : 'register';
      return router.push(`/${page}?next=${encodeURIComponent(`/lot/${listingId}`)}`);
    }
    if (!canBuy) {
      setErr(qtyProblem ?? 'Укажите игровой ID и отметьте, что он верный');
      return;
    }
    setBusy(true);
    setErr(null);
    let orderId: string;
    try {
      orderId = await createOrder();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось оформить заказ. Обновите страницу и попробуйте ещё раз.'));
      setBusy(false);
      return;
    }
    try {
      await payOrder(orderId, method);
      router.push(`/orders/${orderId}`);
    } catch {
      // Заказ уже создан: оплатить его другим способом можно на его странице.
      router.push(`/orders/${orderId}?pay=failed`);
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
          <p className="hint">Скидка учтётся в сумме заказа при оплате.</p>
        </div>
      </details>

      <div style={{ marginBottom: 14 }}>
        <PayMethods base={base} currency={currency} value={method} onChange={setMethod} />
      </div>

      <button className="btn block lg" onClick={buy} disabled={busy || !canBuy} type="button">
        {busy ? 'Оформляем заказ…' : toPay != null ? `Оплатить ${formatPrice(toPay.toString(), currency)}` : 'Оплатить'}
      </button>
      {err && (
        <p className="field-error" role="alert" style={{ marginTop: 10, textAlign: 'center' }}>{err}</p>
      )}
    </>
  );
}
