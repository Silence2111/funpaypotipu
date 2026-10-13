'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, useSession } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { Stars } from '@/components/stars';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  createdAt: string;
  editedAt?: string | null;
  author?: { profile?: { username?: string } | null } | null;
}

/**
 * Публичные отзывы о продавце (по userId). Сам продавец отвечает прямо здесь —
 * как на FunPay, где ответ стоит под отзывом в профиле.
 */
export function SellerReviews({ sellerId }: { sellerId: string }) {
  const [items, setItems] = useState<Review[] | null>(null);
  const { user } = useSession();
  const own = user?.id === sellerId;
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<Review[]>(`/reviews/user/${sellerId}`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [sellerId]);

  useEffect(load, [load]);

  async function sendReply(id: string) {
    setErr(null);
    try {
      await apiFetch(`/reviews/${id}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
      setReplyFor(null);
      load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось сохранить ответ.'));
    }
  }

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
              {r.editedAt ? ' · изменён' : ''}
            </span>
          </div>
          {r.comment && <p className="muted" style={{ fontSize: 14, margin: '8px 0 0' }}>{r.comment}</p>}
          {r.sellerReply && replyFor !== r.id && (
            <p className="faint" style={{ fontSize: 13, margin: '8px 0 0', paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
              Ответ продавца: {r.sellerReply}
            </p>
          )}
          {own &&
            (replyFor === r.id ? (
              <div style={{ marginTop: 10 }}>
                <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="Ответ увидят все покупатели. Контакты скроются." style={{ resize: 'vertical' }} />
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn" type="button" onClick={() => void sendReply(r.id)}>Опубликовать ответ</button>
                  <button className="btn ghost" type="button" onClick={() => setReplyFor(null)}>Отмена</button>
                </div>
                {err && <p className="field-error" role="alert" style={{ marginTop: 8 }}>{err}</p>}
              </div>
            ) : (
              <button className="chip" type="button" style={{ marginTop: 10, fontSize: 13 }}
                onClick={() => { setText(r.sellerReply ?? ''); setErr(null); setReplyFor(r.id); }}>
                {r.sellerReply ? 'Изменить ответ' : 'Ответить'}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
