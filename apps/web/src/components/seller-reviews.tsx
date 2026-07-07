'use client';

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { apiFetch } from '@/lib/session';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  createdAt: string;
  author?: { profile?: { username?: string } | null } | null;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="row" style={{ gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={13} strokeWidth={1.75}
          fill={i <= n ? '#f5a623' : 'none'} color={i <= n ? '#f5a623' : 'var(--fg-faint)'} />
      ))}
    </span>
  );
}

/** Публичные отзывы о продавце (по userId). */
export function SellerReviews({ sellerId }: { sellerId: string }) {
  const [items, setItems] = useState<Review[] | null>(null);

  useEffect(() => {
    apiFetch<Review[]>(`/reviews/user/${sellerId}`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [sellerId]);

  if (items === null) return null;
  if (items.length === 0)
    return <p className="muted" style={{ fontSize: 14 }}>Отзывов о продавце пока нет.</p>;

  return (
    <div className="grid" style={{ gap: 12 }}>
      {items.map((r) => (
        <div key={r.id} className="card" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 8, fontSize: 14 }}>
              <Stars n={r.rating} />
              <span className="faint">{r.author?.profile?.username ?? 'покупатель'}</span>
            </span>
            <span className="faint" style={{ fontSize: 12 }}>
              {new Date(r.createdAt).toLocaleDateString('ru-RU')}
            </span>
          </div>
          {r.comment && <p className="muted" style={{ fontSize: 14, margin: '8px 0 0' }}>{r.comment}</p>}
          {r.sellerReply && (
            <p className="faint" style={{ fontSize: 13, margin: '8px 0 0', paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
              Ответ продавца: {r.sellerReply}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
