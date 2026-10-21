'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { qtyError, qtyTotal } from '@gamemarket/shared/quantity';
import { buyerDataError, type BuyerField } from '@gamemarket/shared/buyer-data';
import { sellerPromoDiscount } from '@gamemarket/shared/seller-promo';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { payOrder } from '@/lib/checkout';
import { formatPrice, formatQty } from '@/lib/format';
import { PayMethods, priceFor, type PayMethod } from '@/components/pay-methods';
import { useT } from '@/lib/i18n/client';

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
  buyerFields = [],
}: {
  listingId: string;
  fulfillmentType?: string;
  /** Цена лота целиком; у поштучного сумма считается из количества. */
  price: string;
  currency: string;
  qtyOffer?: QtyOffer;
  /** Что продавец спрашивает у покупателя: ник, сервер. */
  buyerFields?: BuyerField[];
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [promo, setPromo] = useState('');
  // Проверенный промокод: у кода продавца скидка уже в цене, у кода
  // площадки — при оплате (её потолок считает сервер).
  const [promoInfo, setPromoInfo] = useState<{ source: 'seller' | 'platform'; percent?: number } | null>(null);
  const [promoErr, setPromoErr] = useState<string | null>(null);
  const [account, setAccount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [qtyInput, setQtyInput] = useState(qtyOffer ? String(qtyOffer.minQty) : '1');
  const [method, setMethod] = useState<PayMethod>('sbp');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const isTopUp = fulfillmentType === 'provider';
  const qty = parseQty(qtyInput);
  const qtyRaw = qtyOffer ? qtyError(qty, qtyOffer) : null;
  const qtyProblem = qtyRaw && t.d(qtyRaw);
  const base = qtyOffer
    ? qtyProblem
      ? null
      : qtyTotal(BigInt(qtyOffer.price), qtyOffer.pricePerUnits, qty)
    : BigInt(price);
  const sellerOff = base != null && promoInfo?.source === 'seller' ? sellerPromoDiscount(base, promoInfo.percent ?? 0) : 0n;
  const priced = base != null ? base - sellerOff : null;
  const toPay = priced != null ? priceFor(priced, method) : null;
  const answersRaw = buyerDataError(buyerFields, answers);
  const answersProblem = answersRaw && t.d(answersRaw);
  const canBuy = (!isTopUp || (account.trim().length > 0 && confirmed)) && !qtyProblem;

  async function createOrder() {
    const order = await apiFetch<{ id: string }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        listingId,
        ...(promo.trim() ? { promoCode: promo.trim() } : {}),
        ...(isTopUp && account.trim() ? { account: account.trim() } : {}),
        ...(qtyOffer ? { qty } : {}),
        ...(buyerFields.length ? { buyerData: answers } : {}),
      }),
    });
    return order.id;
  }

  async function applyPromo() {
    setPromoErr(null);
    setPromoInfo(null);
    try {
      setPromoInfo(
        await apiFetch<{ source: 'seller' | 'platform'; percent?: number }>(
          `/promo/check?code=${encodeURIComponent(promo.trim())}&listingId=${listingId}`,
        ),
      );
    } catch (e) {
      setPromoErr(apiErrorMessage(e, t('Промокод не подошёл.')));
    }
  }

  async function buy() {
    if (!getToken()) {
      const page = method === 'balance' ? 'login' : 'register';
      return router.push(`/${page}?next=${encodeURIComponent(`/lot/${listingId}`)}`);
    }
    if (!canBuy) {
      setErr(qtyProblem ?? t('Укажите игровой ID и отметьте, что он верный'));
      return;
    }
    if (answersProblem) {
      setErr(answersProblem);
      return;
    }
    setBusy(true);
    setErr(null);
    let orderId: string;
    try {
      orderId = await createOrder();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось оформить заказ. Обновите страницу и попробуйте ещё раз.')));
      setBusy(false);
      return;
    }
    try {
      // Шлюз с переходом — дальше страница оплаты, вернёт на заказ сам.
      if ((await payOrder(orderId, method)) === 'redirect') return;
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
            {t('Количество')}
            {qtyOffer.unitName ? `, ${t.d(qtyOffer.unitName)}` : ''}
          </label>
          <input id="buy-qty" className="input" inputMode="numeric" autoComplete="off" value={qtyInput}
            onChange={(e) => { setQtyInput(e.target.value); setErr(null); }}
            aria-invalid={!!qtyProblem} aria-describedby="buy-qty-note" />
          {qtyProblem && qtyInput.trim() ? (
            <p className="field-error" id="buy-qty-note">{qtyProblem}</p>
          ) : (
            <p className="hint" id="buy-qty-note">
              {t('От {qty}', {
                qty: qtyOffer.minQty > 1 ? formatQty(qtyOffer.minQty, qtyOffer.unitName, t) : 1,
              })}
              {qtyOffer.stock != null
                ? ` · ${t('в наличии {qty}', { qty: formatQty(qtyOffer.stock, qtyOffer.unitName, t) })}`
                : ''}
            </p>
          )}
        </div>
      )}

      {buyerFields.length > 0 && (
        <div className="stack-form" style={{ gap: 12, marginBottom: 12 }}>
          {buyerFields.map((f, i) => (
            <div key={f.label} className="field">
              <label className="label" htmlFor={`buyer-field-${i}`}>
                {f.label}
                {f.required ? '' : ` — ${t('необязательно')}`}
              </label>
              <input id={`buyer-field-${i}`} className="input" maxLength={100} value={answers[f.label] ?? ''}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => {
                  setAnswers((a) => ({ ...a, [f.label]: e.target.value }));
                  setErr(null);
                }} />
            </div>
          ))}
          <p className="hint" style={{ margin: 0 }}>{t('Продавец увидит это в заказе — переписываться не придётся.')}</p>
        </div>
      )}

      {isTopUp && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label" htmlFor="topup-account">{t('Игровой ID или логин')}</label>
          <input id="topup-account" className="input" placeholder={t('Например, 812345678')} value={account}
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => setAccount(e.target.value)} />
          <label className="row muted" style={{ gap: 10, fontSize: 13, marginTop: 6, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: 2, width: 18, height: 18, accentColor: 'var(--accent)' }} />
            <span>{t('ID верный. Пополнение придёт на этот аккаунт, при ошибке в ID вернуть его нельзя')}</span>
          </label>
        </div>
      )}

      <details style={{ marginBottom: 12 }}>
        <summary className="faint" style={{ fontSize: 13, cursor: 'pointer', minHeight: 32 }}>{t('Есть промокод?')}</summary>
        <div className="field" style={{ marginTop: 8 }}>
          <label className="label" htmlFor="promo" style={{ fontSize: 13 }}>{t('Промокод')}</label>
          <div className="row" style={{ gap: 8 }}>
            <input id="promo" className="input" placeholder={t('Например, START10')} value={promo}
              autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              style={{ flex: 1, minWidth: 0 }}
              onChange={(e) => {
                setPromo(e.target.value);
                setPromoInfo(null);
                setPromoErr(null);
              }} />
            <button type="button" className="chip" disabled={promo.trim().length < 3} onClick={() => void applyPromo()}>
              {t('Применить')}
            </button>
          </div>
          {promoInfo?.source === 'seller' ? (
            <p className="promo-applied">{t('Скидка продавца {pct}% — уже в цене.', { pct: promoInfo.percent ?? 0 })}</p>
          ) : promoInfo ? (
            <p className="promo-applied">{t('Промокод площадки: скидка учтётся в сумме заказа.')}</p>
          ) : promoErr ? (
            <p className="field-error">{promoErr}</p>
          ) : (
            <p className="hint">{t('Скидка учтётся в сумме заказа при оплате.')}</p>
          )}
        </div>
      </details>

      <div style={{ marginBottom: 14 }}>
        <PayMethods base={priced} currency={currency} value={method} onChange={setMethod} />
      </div>

      <button className="btn block lg" onClick={buy} disabled={busy || !canBuy} type="button">
        {busy
          ? t('Оформляем заказ…')
          : toPay != null
            ? t('Оплатить {sum}', { sum: formatPrice(toPay.toString(), currency, t) })
            : t('Оплатить')}
      </button>
      {err && (
        <p className="field-error" role="alert" style={{ marginTop: 10, textAlign: 'center' }}>{err}</p>
      )}
    </>
  );
}
