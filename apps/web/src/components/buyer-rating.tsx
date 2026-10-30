'use client';

import { useCallback, useEffect, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { userText } from '@/lib/hidden';

interface BuyerReview {
  good: boolean;
  comment: string | null;
}
interface State {
  review: BuyerReview | null;
  canRate: boolean;
  stats: { deals: number; good: number; bad: number } | null;
}

/**
 * Покупатель глазами продавца — в заказе: сколько у него покупок и как его
 * оценили другие продавцы; после сделки — «Порекомендую» или «Не
 * порекомендую» с комментарием, который увидит только покупатель; оценку
 * можно изменить в срок или убрать. Покупателю — оценка, которую ему
 * поставили.
 */
export function BuyerRating({ orderId, role }: { orderId: string; role: 'buyer' | 'seller' }) {
  const t = useT();
  const [state, setState] = useState<State | null>(null);
  const [good, setGood] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  // «Убрать оценку» спрашивает подтверждение в той же карточке.
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await apiFetch<State>(`/orders/${orderId}/buyer-review`).catch(() => null);
    setState(s);
    setGood(s?.review?.good ?? null);
    setComment(s?.review?.comment ?? '');
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!state) return null;
  const { review, stats, canRate } = state;

  async function save() {
    if (good === null) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/orders/${orderId}/buyer-review`, {
        method: 'PUT',
        body: JSON.stringify({ good, comment: comment.trim() || null }),
      });
      setEditing(false);
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось сохранить.')));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/orders/${orderId}/buyer-review`, { method: 'DELETE' });
      setRemoving(false);
      setRemoved(true);
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось убрать оценку.')));
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit() {
    setGood(review?.good ?? null);
    setComment(review?.comment ?? '');
    setErr(null);
    setEditing(false);
  }

  if (role === 'buyer') {
    if (!review) return null;
    return (
      <div className="card flat buyer-rating" style={{ marginTop: 16 }}>
        <p className="buyer-rating-verdict" data-good={review.good ? 'true' : 'false'}>
          {review.good ? (
            <ThumbsUp size={16} strokeWidth={1.75} aria-hidden />
          ) : (
            <ThumbsDown size={16} strokeWidth={1.75} aria-hidden />
          )}
          {review.good
            ? t('Продавец рекомендует вас как покупателя')
            : t('Продавец не рекомендует вас как покупателя')}
        </p>
        {review.comment && (
          <p className="muted buyer-rating-comment">«{userText(t, review.comment)}»</p>
        )}
        <p className="hint" style={{ margin: 0 }}>
          {t('Комментарий видите только вы, в профиле — только число оценок.')}
        </p>
      </div>
    );
  }

  const rated = (stats?.good ?? 0) + (stats?.bad ?? 0);
  const form = canRate && (!review || editing);
  return (
    <div className="card flat buyer-rating" style={{ marginTop: 16 }}>
      {stats && (
        <p className="buyer-rating-stats">
          {stats.deals === 0 && rated === 0
            ? t('Покупатель: первая покупка на площадке.')
            : t('Покупатель: {deals}; продавцы рекомендуют — {good}, не рекомендуют — {bad}.', {
                deals: t.n(stats.deals, 'покупка', 'покупки', 'покупок'),
                good: stats.good,
                bad: stats.bad,
              })}
        </p>
      )}
      {review && !editing && (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="buyer-rating-verdict" data-good={review.good ? 'true' : 'false'}>
            {review.good ? (
              <ThumbsUp size={16} strokeWidth={1.75} aria-hidden />
            ) : (
              <ThumbsDown size={16} strokeWidth={1.75} aria-hidden />
            )}
            {review.good
              ? t('Вы рекомендуете этого покупателя')
              : t('Вы не рекомендуете этого покупателя')}
          </span>
          {canRate && !removing && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setRemoved(false);
                setEditing(true);
              }}
            >
              {t('Изменить')}
            </button>
          )}
          {!removing && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setErr(null);
                setRemoving(true);
              }}
            >
              {t('Убрать оценку')}
            </button>
          )}
        </div>
      )}
      {review && removing && (
        <div className="buyer-rating-confirm" role="group" aria-label={t('Убрать оценку')}>
          <span>
            {t('Убрать оценку? Покупатель перестанет её видеть, в профиле она не будет считаться.')}{' '}
            {canRate
              ? t('Поставить снова можно в течение 30 дней после сделки.')
              : t('Срок оценки прошёл — поставить её снова будет нельзя.')}
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => void remove()}
            >
              {t('Убрать')}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setRemoving(false)}
            >
              {t('Отмена')}
            </button>
          </span>
          {err && (
            <p className="field-error" role="alert" style={{ margin: 0 }}>
              {err}
            </p>
          )}
        </div>
      )}
      {removed && !review && (
        <p className="hint" role="status" style={{ margin: 0 }}>
          {t('Оценка убрана.')}
        </p>
      )}
      {form && (
        <div className="buyer-rating-form">
          <span className="label">{t('Оцените покупателя')}</span>
          <div
            className="row"
            style={{ gap: 8, flexWrap: 'wrap' }}
            role="group"
            aria-label={t('Оцените покупателя')}
          >
            <button
              type="button"
              className="chip"
              aria-pressed={good === true}
              onClick={() => setGood(true)}
            >
              <ThumbsUp size={16} strokeWidth={1.75} aria-hidden /> {t('Порекомендую')}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={good === false}
              onClick={() => setGood(false)}
            >
              <ThumbsDown size={16} strokeWidth={1.75} aria-hidden /> {t('Не порекомендую')}
            </button>
          </div>
          <textarea
            className="input"
            rows={2}
            maxLength={300}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('Комментарий — необязательно, его увидит только покупатель')}
            aria-label={t('Комментарий для покупателя')}
          />
          {err && (
            <p className="field-error" role="alert">
              {err}
            </p>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={busy || good === null}
              onClick={() => void save()}
            >
              {t('Сохранить оценку')}
            </button>
            {review && (
              <button type="button" className="btn ghost" disabled={busy} onClick={cancelEdit}>
                {t('Отмена')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
