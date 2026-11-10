'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Repeat } from 'lucide-react';
import type { ListingCard } from '@/lib/api';
import { apiFetch } from '@/lib/session';
import { useT } from '@/lib/i18n/client';

/**
 * «Купить снова» в завершённом заказе: страница лота с тем же количеством,
 * у пополнения — с тем же аккаунтом и суммой. Лот закончился — ведёт к
 * «Сообщить о поступлении»; снят или удалён — кнопки нет.
 */
export function BuyAgain({
  listingId,
  qty,
  account,
  topupAmount,
}: {
  listingId: string;
  qty?: number;
  account?: string;
  /** Сумма пополнения в копейках. */
  topupAmount?: string;
}) {
  const t = useT();
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ListingCard[]>(`/listings/cards?ids=${listingId}`)
      .then((r) => setStatus(r[0]?.status ?? null))
      .catch(() => {});
  }, [listingId]);

  if (status !== 'active' && status !== 'sold_out') return null;
  const params = new URLSearchParams();
  if (account) params.set('account', account);
  if (topupAmount && /^\d+00$/.test(topupAmount)) params.set('amount', topupAmount.slice(0, -2));
  if (qty && qty > 1) params.set('qty', String(qty));
  const query = params.toString();
  return (
    <Link href={`/lot/${listingId}${query ? `?${query}` : ''}#buy`} className="btn secondary">
      <Repeat size={16} strokeWidth={1.75} aria-hidden />
      {status === 'active' ? t('Купить снова') : t('Закончился — сообщить о поступлении')}
    </Link>
  );
}
