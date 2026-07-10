'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { formatPrice } from '@/lib/format';

interface Tx {
  id: string;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
  orderId: string | null;
  refType: string | null;
  createdAt: string;
}

const REF_RU: Record<string, string> = {
  balance_topup: 'Пополнение баланса',
  order_payment_balance: 'Оплата заказа с баланса',
  order_payment: 'Оплата заказа',
  escrow_release: 'Зачисление за продажу',
  cashback: 'Кэшбэк за покупку',
  refund: 'Возврат',
  payout: 'Вывод средств',
  payout_hold: 'Заявка на вывод',
};

export function WalletTransactions() {
  const [items, setItems] = useState<Tx[] | null>(null);

  useEffect(() => {
    apiFetch<Tx[]>('/wallet/transactions')
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  if (items === null) return null;
  if (items.length === 0)
    return <p className="faint" style={{ fontSize: 13, marginTop: 12 }}>Операций пока нет.</p>;

  return (
    <div className="grid" style={{ gap: 0, marginTop: 12 }}>
      {items.map((t) => {
        const positive = t.direction === 'credit';
        return (
          <div key={t.id} className="row"
            style={{ justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 14 }}>
              {REF_RU[t.refType ?? ''] ?? t.refType ?? 'Операция'}
              <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>
                {new Date(t.createdAt).toLocaleDateString('ru-RU')}
              </span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 500, color: positive ? '#1a7f37' : 'var(--fg)' }}>
              {positive ? '+' : '−'}{formatPrice(t.amount, t.currency)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
