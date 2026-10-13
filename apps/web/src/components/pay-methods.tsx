'use client';

import { useEffect, useState } from 'react';
// Подпуть, а не корень пакета: корень тянет в браузер zod и все контракты.
import { chargeFor, PAYMENT_METHODS } from '@gamemarket/shared/payment';
import { apiFetch, getToken } from '@/lib/session';
import { formatPrice } from '@/lib/format';

/** Способ оплаты, как его выбирает покупатель. Карта, Apple Pay и Google Pay — одна строка: надбавка у них общая. */
export type PayMethod = 'sbp' | 'card' | 'crypto' | 'balance';

const ROWS: Array<{ key: PayMethod; label: string }> = [
  { key: 'sbp', label: 'СБП' },
  { key: 'card', label: 'Карта, Apple Pay, Google Pay' },
  { key: 'crypto', label: 'Криптовалюта, USDT' },
  { key: 'balance', label: 'С баланса' },
];

/** Сколько спишут этим способом — та же функция, что считает сумму платежа на сервере. */
export const priceFor = (base: bigint, method: PayMethod): bigint => chargeFor(base, method).charge;

const feeLabel = (pct: number) => `+${String(Math.round(pct * 1000) / 10).replace('.', ',')}%`;

/** «+4,4%» у способа с комиссией, null — без неё. */
export const methodFee = (method: PayMethod): string | null => {
  const fee = PAYMENT_METHODS.find((m) => m.key === method)?.feePct ?? 0;
  return fee ? feeLabel(fee) : null;
};

/**
 * Выбор способа оплаты с ценой по каждому — как на FunPay: покупатель видит,
 * сколько спишут картой, а сколько по СБП, до того как нажмёт «Оплатить».
 * Баланс подтягивается сам; если его не хватает, строка недоступна.
 *
 * `list` — строки с ценами (панель покупки), `select` — компактный список
 * для виджета в первом экране главной.
 */
export function PayMethods({
  base,
  currency,
  value,
  onChange,
  variant = 'list',
  id = 'pay-method',
  withBalance = true,
}: {
  /** Сумма заказа без надбавки; null — сумма ещё не выбрана. */
  base: bigint | null;
  currency: string;
  value: PayMethod;
  onChange: (m: PayMethod) => void;
  variant?: 'list' | 'select';
  id?: string;
  /** Пополнение баланса балансом не оплачивается — там строки нет. */
  withBalance?: boolean;
}) {
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (!withBalance || !getToken()) return;
    apiFetch<{ balance: string }>('/wallet')
      .then((w) => setBalance(BigInt(w.balance)))
      .catch(() => {});
  }, [withBalance]);

  const short = balance != null && base != null && balance < base;
  // Денег на балансе не хватает — выбор не остаётся на недоступной строке.
  useEffect(() => {
    if (short && value === 'balance') onChange('sbp');
  }, [short, value, onChange]);

  const rows = ROWS.filter((r) => withBalance || r.key !== 'balance').map((r) => {
    const fee = PAYMENT_METHODS.find((m) => m.key === r.key)?.feePct ?? 0;
    return {
      ...r,
      price: base != null ? formatPrice(priceFor(base, r.key).toString(), currency) : '—',
      disabled: r.key === 'balance' && short,
      note:
        r.key === 'balance'
          ? balance != null
            ? `на балансе ${formatPrice(balance.toString(), currency)}`
            : null
          : fee
            ? `комиссия способа ${feeLabel(fee)}`
            : null,
    };
  });

  if (variant === 'select') {
    return (
      <div className="field">
        <label className="label" htmlFor={id}>Способ оплаты</label>
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as PayMethod)}>
          {rows.map((r) => (
            <option key={r.key} value={r.key} disabled={r.disabled}>
              {r.label} — {r.price}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <fieldset className="pay-methods">
      <legend className="label">Способ оплаты</legend>
      {rows.map((r) => (
        <label key={r.key} className="pay-method">
          <input
            type="radio"
            name={id}
            value={r.key}
            checked={value === r.key}
            disabled={r.disabled}
            onChange={() => onChange(r.key)}
          />
          <span className="pm-label">
            {r.label}
            {r.note && <span className="pm-note">{r.note}</span>}
          </span>
          <span className="pm-price">{r.price}</span>
        </label>
      ))}
    </fieldset>
  );
}
