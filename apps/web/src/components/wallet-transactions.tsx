'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface Tx {
  id: string;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
  orderId: string | null;
  refType: string | null;
  createdAt: string;
}

/** Подписи операций — по refType проводок; неизвестное — «Операция», а не сырой ключ. */
const REF: Record<string, string> = {
  balance_topup: msg('Пополнение баланса'),
  order_payment_balance: msg('Оплата заказа с баланса'),
  order_payment: msg('Оплата заказа'),
  order_release: msg('Зачисление за продажу'),
  dispute_release: msg('Зачисление по решению спора'),
  cashback: msg('Кэшбэк за покупку'),
  order_refund: msg('Возврат: заказ отменён'),
  order_refund_overdue: msg('Возврат: продавец не выдал товар'),
  seller_refund: msg('Возврат от продавца'),
  dispute_refund: msg('Возврат по решению спора'),
  oos_refund: msg('Возврат: товар закончился'),
  late_payment: msg('Повторная оплата заказа — на баланс'),
  promotion: msg('Продвижение лота'),
  payout_hold: msg('Заявка на вывод'),
  payout_reverse: msg('Заявка на вывод отклонена'),
  payout_settle: msg('Вывод средств'),
};

export function WalletTransactions() {
  const t = useT();
  const [items, setItems] = useState<Tx[] | null>(null);

  useEffect(() => {
    apiFetch<Tx[]>('/wallet/transactions')
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  if (items === null) return null;
  if (items.length === 0)
    return <p className="faint" style={{ fontSize: 13, marginTop: 12 }}>{t('Операций пока нет.')}</p>;

  return (
    <div className="grid" style={{ gap: 0, marginTop: 12 }}>
      {items.map((tx) => {
        const positive = tx.direction === 'credit';
        return (
          <div key={tx.id} className="row"
            style={{ justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 14 }}>
              {REF[tx.refType ?? ''] ? t(REF[tx.refType ?? '']!) : t('Операция')}
              <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>
                {new Date(tx.createdAt).toLocaleDateString(t.locale)}
              </span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 500, color: positive ? 'var(--success)' : 'var(--fg)' }}>
              {positive ? '+' : '−'}{formatPrice(tx.amount, tx.currency, t)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
