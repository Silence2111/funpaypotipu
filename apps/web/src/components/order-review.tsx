'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { StarInput, Stars } from '@/components/stars';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  createdAt: string;
  editedAt: string | null;
  editableUntil: string;
}

/**
 * Отзыв на странице завершённого заказа.
 *
 * Покупатель: оставить, а в первые 14 дней — изменить или удалить.
 * Продавец: прочитать и ответить. Раньше страница не знала об уже
 * оставленном отзыве: после перезагрузки форма появлялась снова и падала на 409.
 */
export function OrderReview({ orderId, role }: { orderId: string; role: 'buyer' | 'seller' }) {
  const [review, setReview] = useState<Review | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setReview(await apiFetch<Review | null>(`/reviews/by-order/${orderId}`).catch(() => null));
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      setEditing(false);
      setReplying(false);
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  if (review === undefined) return null;

  const canEdit = role === 'buyer' && !!review && new Date(review.editableUntil).getTime() > Date.now();
  const form = !review || editing;

  if (!review && role === 'seller')
    return (
      <p className="hint" style={{ marginTop: 16 }}>
        Покупатель ещё не оставил отзыв.
      </p>
    );

  return (
    <div className="card" style={{ marginTop: 16, padding: 20 }}>
      {form && role === 'buyer' ? (
        <>
          <div className="label" style={{ marginBottom: 8 }}>
            {review ? 'Изменить отзыв' : 'Оцените продавца'}
          </div>
          <StarInput value={rating} onChange={setRating} />
          <textarea
            className="input"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Что понравилось, что нет — необязательно"
            style={{ resize: 'vertical', marginTop: 10 }}
          />
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                if (rating < 1) return setErr('Поставьте оценку');
                void run(
                  () =>
                    review
                      ? apiFetch(`/reviews/${review.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ rating, comment: comment.trim() || null }),
                        })
                      : apiFetch('/reviews', {
                          method: 'POST',
                          body: JSON.stringify({ orderId, rating, comment: comment.trim() || undefined }),
                        }),
                  'Не удалось сохранить отзыв.',
                );
              }}
            >
              {review ? 'Сохранить' : 'Оставить отзыв'}
            </button>
            {review && (
              <button className="btn ghost" type="button" onClick={() => setEditing(false)}>
                Отмена
              </button>
            )}
          </div>
        </>
      ) : review ? (
        <>
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span className="label">{role === 'buyer' ? 'Ваш отзыв' : 'Отзыв покупателя'}</span>
            <span className="row faint" style={{ gap: 8, fontSize: 12 }}>
              <Stars n={review.rating} />
              {new Date(review.createdAt).toLocaleDateString('ru-RU')}
              {review.editedAt ? ' · изменён' : ''}
            </span>
          </div>
          {review.comment && <p style={{ margin: '8px 0 0', fontSize: 15 }}>{review.comment}</p>}
          {review.sellerReply && !replying && (
            <p className="muted" style={{ fontSize: 14, margin: '10px 0 0', paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
              Ответ продавца: {review.sellerReply}
            </p>
          )}
          {canEdit && (
            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                className="chip"
                type="button"
                onClick={() => {
                  setRating(review.rating);
                  setComment(review.comment ?? '');
                  setEditing(true);
                }}
              >
                Изменить
              </button>
              <button
                className="chip"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Удалить отзыв? Рейтинг продавца пересчитается без него.'))
                    void run(() => apiFetch(`/reviews/${review.id}`, { method: 'DELETE' }), 'Не удалось удалить отзыв.');
                }}
              >
                Удалить
              </button>
              <span className="hint">
                Можно до {new Date(review.editableUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
              </span>
            </div>
          )}
          {role === 'seller' &&
            (replying ? (
              <div style={{ marginTop: 12 }}>
                <textarea
                  className="input"
                  rows={2}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Ответ увидят все покупатели. Контакты скроются."
                  style={{ resize: 'vertical' }}
                />
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => apiFetch(`/reviews/${review.id}/reply`, { method: 'POST', body: JSON.stringify({ text: reply }) }),
                        'Не удалось сохранить ответ.',
                      )
                    }
                  >
                    Опубликовать ответ
                  </button>
                  <button className="btn ghost" type="button" onClick={() => setReplying(false)}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="chip"
                type="button"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setReply(review.sellerReply ?? '');
                  setReplying(true);
                }}
              >
                {review.sellerReply ? 'Изменить ответ' : 'Ответить на отзыв'}
              </button>
            ))}
        </>
      ) : null}
      {err && (
        <p className="field-error" role="alert" style={{ marginTop: 10 }}>
          {err}
        </p>
      )}
    </div>
  );
}
