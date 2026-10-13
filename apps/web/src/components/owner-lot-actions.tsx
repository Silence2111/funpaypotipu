'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { getUser } from '@/lib/session';

/**
 * «Изменить лот» — только владельцу. Страница лота рендерится на сервере и не
 * знает, кто смотрит: сессия живёт в браузере, поэтому проверка здесь.
 */
export function OwnerLotActions({ listingId, sellerId }: { listingId: string; sellerId: string }) {
  const [mine, setMine] = useState(false);
  useEffect(() => setMine(getUser()?.id === sellerId), [sellerId]);
  if (!mine) return null;
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
      <Link href={`/cabinet/lot/${listingId}`} className="chip">
        <Pencil size={14} strokeWidth={1.75} /> Изменить лот
      </Link>
      <Link href="/cabinet/lots" className="chip">
        Мои лоты
      </Link>
    </div>
  );
}
