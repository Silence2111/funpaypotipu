'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { StarInput, Stars } from '@/components/stars';
import { useT } from '@/lib/i18n/client';
import { ReviewPhotoPicker, ReviewPhotos, type ReviewPhoto } from './review-photos';
import { userText } from '@/lib/hidden';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  createdAt: string;
  editedAt: string | null;
  editableUntil: string;
  images: ReviewPhoto[];
}

/**
 * Отзыв на странице завершённого заказа.
 *
 * Покупатель: оставить, а в первые 14 дней — изменить или удалить.
 * Продавец: прочитать и ответить. Раньше страница не знала об уже
 * оставленном отзыве: после перезагрузки форма появлялась снова и падала на 409.
 */
export function OrderReview({ orderId, role }: { orderId: string; role: 'buyer' | 'seller' }) {
  const t = useT();
  const [review, setReview] = useState<Review | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<ReviewPhoto[]>([]);
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
        {t('Покупатель ещё не оставил отзыв.')}
      </p>
    );

  return (
    <div className="card" style={{ marginTop: 16, padding: 20 }}>
      {form && role === 'buyer' ? (
        <>
          <div className="label" style={{ marginBottom: 8 }}>
            {review ? t('Изменить отзыв') : t('Оцените продавца')}
          </div>
          <StarInput value={rating} onChange={setRating} />
          <textarea
            className="input"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('Что понравилось, что нет — необязательно')}
            style={{ resize: 'vertical', marginTop: 10 }}
          />
          <ReviewPhotoPicker value={photos} onChange={setPhotos} />
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                if (rating < 1) return setErr(t('Поставьте оценку'));
                void run(
                  () =>
                    review
                      ? apiFetch(`/reviews/${review.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            rating,
                            comment: comment.trim() || null,
                            images: photos.map((p) => p.key),
                          }),
                        })
                      : apiFetch('/reviews', {
                          method: 'POST',
                          body: JSON.stringify({
                            orderId,
                            rating,
                            comment: comment.trim() || undefined,
                            images: photos.map((p) => p.key),
                          }),
                        }),
                  t('Не удалось сохранить отзыв.'),
                );
              }}
            >
              {review ? t('Сохранить') : t('Оставить отзыв')}
            </button>
            {review && (
              <button className="btn ghost" type="button" onClick={() => setEditing(false)}>
                {t('Отмена')}
              </button>
            )}
          </div>
        </>
      ) : review ? (
        <>
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span className="label">{role === 'buyer' ? t('Ваш отзыв') : t('Отзыв покупателя')}</span>
            <span className="row faint" style={{ gap: 8, fontSize: 12 }}>
              <Stars n={review.rating} />
              {new Date(review.createdAt).toLocaleDateString(t.locale)}
              {review.editedAt ? ` · ${t('изменён')}` : ''}
            </span>
          </div>
          {review.comment && <p style={{ margin: '8px 0 0', fontSize: 15 }}>{userText(t, review.comment)}</p>}
          <ReviewPhotos images={review.images.map((p) => p.url)} />
          {review.sellerReply && !replying && (
            <p className="muted" style={{ fontSize: 14, margin: '10px 0 0', paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
              {t('Ответ продавца:')} {userText(t, review.sellerReply)}
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
                  setPhotos(review.images);
                  setEditing(true);
                }}
              >
                {t('Изменить')}
              </button>
              <button
                className="chip"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('Удалить отзыв? Рейтинг продавца пересчитается без него.')))
                    void run(() => apiFetch(`/reviews/${review.id}`, { method: 'DELETE' }), t('Не удалось удалить отзыв.'));
                }}
              >
                {t('Удалить')}
              </button>
              <span className="hint">
                {t('Можно до {date}', {
                  date: new Date(review.editableUntil).toLocaleDateString(t.locale, { day: 'numeric', month: 'long' }),
                })}
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
                  placeholder={t('Ответ увидят все покупатели. Контакты скроются.')}
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
                        t('Не удалось сохранить ответ.'),
                      )
                    }
                  >
                    {t('Опубликовать ответ')}
                  </button>
                  <button className="btn ghost" type="button" onClick={() => setReplying(false)}>
                    {t('Отмена')}
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
                {review.sellerReply ? t('Изменить ответ') : t('Ответить на отзыв')}
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
