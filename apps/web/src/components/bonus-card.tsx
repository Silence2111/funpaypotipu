'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';

interface Entry {
  id: string;
  amount: string;
  kind: 'accrual' | 'spend' | 'refund';
  orderId: string | null;
  createdAt: string;
}

/**
 * Бонусы в кошельке (часть 146): сколько есть и откуда. Не деньги — не
 * выводятся, списываются скидкой при оплате. Блок виден, только если бонусы
 * когда-нибудь были.
 */
export function BonusCard() {
  const t = useT();
  const [data, setData] = useState<{ balance: string; entries: Entry[] } | null>(null);

  useEffect(() => {
    apiFetch<{ balance: string; entries: Entry[] }>('/account/bonuses').then(setData).catch(() => setData(null));
  }, []);

  if (!data || data.entries.length === 0) return null;
  const KIND: Record<Entry['kind'], string> = {
    accrual: t('начислено за заказ'),
    spend: t('списано в заказе'),
    refund: t('возвращено: заказ отменён'),
  };
  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="h2" style={{ fontSize: 20 }}>
        {t('Бонусы')} · {formatPrice(data.balance, 'RUB', t)}
      </h2>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 14 }}>
        {t('Спишутся скидкой при оплате следующего заказа — галочкой у кнопки «Оплатить». Не выводятся.')}
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6, fontSize: 14 }}>
        {data.entries.slice(0, 10).map((e) => (
          <li key={e.id} className="row" style={{ gap: 12, justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'nowrap' }}>
            <span style={{ minWidth: 0 }}>
              {e.orderId ? <Link href={`/orders/${e.orderId}`}>{KIND[e.kind]}</Link> : KIND[e.kind]}
              <span className="faint"> · {new Date(e.createdAt).toLocaleDateString(t.locale)}</span>
            </span>
            <b style={{ color: e.amount.startsWith('-') ? 'var(--text)' : 'var(--success)', whiteSpace: 'nowrap' }}>
              {e.amount.startsWith('-') ? '−' : '+'}
              {formatPrice(e.amount.replace('-', ''), 'RUB', t)}
            </b>
          </li>
        ))}
      </ul>
    </section>
  );
}
