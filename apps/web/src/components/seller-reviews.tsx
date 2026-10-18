'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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
  /** Игра и раздел сделки, сумма — вилкой. */
  game: { slug: string; title: string };
  section: { slug: string; title: string };
  amountRange: string;
}

const PAGE = 20;

/**
 * Отзывы о продавце, как на FunPay: оценка, игра и раздел сделки, сумма
 * вилкой, текст и ответ продавца. Сам продавец отвечает прямо здесь.
 *
 * В профиле — фильтр по оценке и «Показать ещё»; на странице лота —
 * последние несколько и ссылка на все.
 */
export function SellerReviews({
  sellerId,
  breakdown,
  preview,
}: {
  sellerId: string;
  /** Сколько отзывов с каждой оценкой — для фильтра в профиле. */
  breakdown?: Array<{ star: number; count: number }>;
  /** Показать только столько последних и ссылку на профиль. */
  preview?: number;
}) {
  const { user } = useSession();
  const own = user?.id === sellerId;
  const [rating, setRating] = useState<number | null>(null);
  const [items, setItems] = useState<Review[] | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const limit = preview ?? PAGE;

  const load = useCallback(
    (p: number, append: boolean) => {
      const q = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (rating) q.set('rating', String(rating));
      apiFetch<Review[]>(`/reviews/user/${sellerId}?${q}`)
        .then((rows) => {
          setItems((prev) => (append && prev ? [...prev, ...rows] : rows));
          setMore(!preview && rows.length === limit);
          setPage(p);
        })
        .catch(() => setItems((prev) => prev ?? []));
    },
    [sellerId, rating, limit, preview],
  );

  useEffect(() => load(1, false), [load]);

  async function sendReply(id: string) {
    setErr(null);
    try {
      await apiFetch(`/reviews/${id}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
      setReplyFor(null);
      load(1, false);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось сохранить ответ.'));
    }
  }

  const total = breakdown?.reduce((n, b) => n + b.count, 0) ?? 0;

  return (
    <div>
      {breakdown && total > 0 && (
        <nav className="row" aria-label="Оценка" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <button type="button" className="chip" aria-pressed={rating === null} onClick={() => setRating(null)}>
            Все <span className="faint">{total}</span>
          </button>
          {[5, 4, 3, 2, 1].map((star) => {
            const count = breakdown.find((b) => b.star === star)?.count ?? 0;
            return (
              <button
                key={star}
                type="button"
                className="chip"
                aria-pressed={rating === star}
                disabled={count === 0}
                onClick={() => setRating(star)}
              >
                {star} ★ <span className="faint">{count}</span>
              </button>
            );
          })}
        </nav>
      )}

      {items === null ? null : items.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          {rating ? 'С такой оценкой отзывов нет.' : 'Отзывов о продавце пока нет.'}
        </p>
      ) : (
        <div className="reviews">
          {items.map((r) => (
            <article key={r.id} className="review">
              <div className="review-head">
                <Stars n={r.rating} />
                <Link href={`/igra/${r.game.slug}/${r.section.slug}`} className="review-deal">
                  {r.game.title} · {r.section.title}
                </Link>
                <span className="faint">{r.amountRange}</span>
                <span className="spacer" />
                <time className="faint" dateTime={r.createdAt}>
                  {new Date(r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {r.editedAt ? ' · изменён' : ''}
                </time>
              </div>
              {r.comment && <p className="review-text">{r.comment}</p>}
              {r.sellerReply && replyFor !== r.id && (
                <p className="review-reply">
                  <span className="faint">Ответ продавца:</span> {r.sellerReply}
                </p>
              )}
              {own &&
                (replyFor === r.id ? (
                  <div style={{ marginTop: 10 }}>
                    <textarea
                      className="input"
                      rows={2}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Ответ увидят все покупатели. Контакты скроются."
                      style={{ resize: 'vertical' }}
                    />
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <button className="btn" type="button" onClick={() => void sendReply(r.id)}>
                        Опубликовать ответ
                      </button>
                      <button className="btn ghost" type="button" onClick={() => setReplyFor(null)}>
                        Отмена
                      </button>
                    </div>
                    {err && (
                      <p className="field-error" role="alert" style={{ marginTop: 8 }}>
                        {err}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    className="chip"
                    type="button"
                    style={{ marginTop: 10, fontSize: 13 }}
                    onClick={() => {
                      setText(r.sellerReply ?? '');
                      setErr(null);
                      setReplyFor(r.id);
                    }}
                  >
                    {r.sellerReply ? 'Изменить ответ' : 'Ответить'}
                  </button>
                ))}
            </article>
          ))}
        </div>
      )}

      {more && (
        <button type="button" className="btn secondary" style={{ marginTop: 16 }} onClick={() => load(page + 1, true)}>
          Показать ещё
        </button>
      )}
      {preview && items && items.length >= preview && (
        <p style={{ marginTop: 12, fontSize: 14 }}>
          <Link href={`/prodavec/${sellerId}#reviews`} className="inline-link">
            Все отзывы о продавце
          </Link>
        </p>
      )}
    </div>
  );
}
