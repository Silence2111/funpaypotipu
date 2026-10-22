'use client';

import { useEffect, useState } from 'react';
import type { ListingCard } from '@/lib/api';
import { apiFetch } from '@/lib/session';
import { clearRecent, recentLots } from '@/lib/recent';
import { useT } from '@/lib/i18n/client';
import { OfferTable } from './offers';

/**
 * «Вы смотрели»: последние открытые лоты из истории браузера —
 * в продаже и закончившиеся, свежие сверху. Пусто — блока нет.
 */
export function RecentLots({
  exclude,
  limit = 6,
  compact = false,
}: {
  /** Лот, на странице которого блок стоит, — себя не показываем. */
  exclude?: string;
  limit?: number;
  compact?: boolean;
}) {
  const t = useT();
  const [items, setItems] = useState<ListingCard[]>([]);

  useEffect(() => {
    const ids = recentLots()
      .filter((id) => id !== exclude)
      .slice(0, limit);
    if (!ids.length) return;
    apiFetch<ListingCard[]>(`/listings/cards?ids=${ids.join(',')}`)
      .then(setItems)
      .catch(() => {});
  }, [exclude, limit]);

  if (!items.length) return null;
  return (
    <section aria-labelledby="recent-title">
      <div className="section-head" style={{ marginBottom: 12 }}>
        <h2 className={compact ? 'h2 lot-h2' : 'h2'} id="recent-title" style={{ margin: 0 }}>
          {t('Вы смотрели')}
        </h2>
        <button
          type="button"
          className="btn ghost"
          style={{ fontSize: 14 }}
          onClick={() => {
            clearRecent();
            setItems([]);
          }}
        >
          {t('Очистить')}
        </button>
      </div>
      <OfferTable items={items} showSection compact={compact} t={t} />
    </section>
  );
}
