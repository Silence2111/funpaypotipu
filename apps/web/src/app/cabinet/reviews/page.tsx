'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { replaceUrl, withQuery } from '@/lib/url';
import { CabinetNav } from '@/components/cabinet-nav';
import { Stars } from '@/components/stars';
import { ReviewPhotos } from '@/components/review-photos';
import { useT } from '@/lib/i18n/client';

type Tab = 'received' | 'written';
/** auto — есть без ответа, показываем их, иначе все; open и all — выбрал человек. */
type Filter = 'auto' | 'open' | 'all';

interface MyReview {
  id: string;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  repliedAt: string | null;
  createdAt: string;
  editedAt: string | null;
  images: string[];
  order: { id: string; publicNumber: string; title: string | null };
  counterpart: string | null;
  editable?: boolean;
  editableUntil?: string;
}

interface Mine {
  items: MyReview[];
  more: boolean;
  counts: { received: number; unanswered: number; written: number };
}

/**
 * Отзывы в кабинете: полученные — от покупателей, с ответом прямо в списке
 * (сначала показываем те, где ответа ещё нет); оставленные — мои отзывы о
 * продавцах, с ответом продавца и ссылкой на правку, пока её срок не вышел.
 */
function ReviewsInner() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'written' ? 'written' : 'received');
  const [filter, setFilter] = useState<Filter>(
    params.get('unanswered') === '1' ? 'open' : params.get('unanswered') === '0' ? 'all' : 'auto',
  );
  const [data, setData] = useState<Mine | null>(null);
  // Что на самом деле в списке: только без ответа или все.
  const [openShown, setOpenShown] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [text, setText] = useState('');

  const url = useCallback(
    (p: number, open: boolean) =>
      `/reviews/mine?tab=${tab}${tab === 'received' && open ? '&unanswered=1' : ''}&page=${p}`,
    [tab],
  );

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent('/cabinet/reviews')}`);
      return;
    }
    let stop = false;
    setData(null);
    setErr(null);
    setPage(1);
    (async () => {
      let open = tab === 'received' && filter !== 'all';
      let r = await apiFetch<Mine>(url(1, open));
      // Без ответа нет ни одного — сразу все отзывы.
      if (filter === 'auto' && open && r.counts.unanswered === 0) {
        open = false;
        r = await apiFetch<Mine>(url(1, false));
      }
      if (stop) return;
      setOpenShown(open);
      setData(r);
    })().catch((e) => !stop && setErr(apiErrorMessage(e, t('Не удалось загрузить отзывы.'))));
    return () => {
      stop = true;
    };
  }, [tab, filter, url, router, t]);

  function go(nextTab: Tab, nextFilter: Filter) {
    setTab(nextTab);
    setFilter(nextFilter);
    setReplyFor(null);
    const received = nextTab === 'received' && nextFilter !== 'auto';
    replaceUrl(
      withQuery(pathname, {
        tab: nextTab === 'written' && 'written',
        unanswered: received && (nextFilter === 'open' ? '1' : '0'),
      }),
    );
  }

  async function more() {
    if (!data?.more) return;
    setBusy(true);
    try {
      const r = await apiFetch<Mine>(url(page + 1, openShown));
      setData({ ...r, items: [...data.items, ...r.items] });
      setPage(page + 1);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось загрузить отзывы.')));
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(r: MyReview) {
    setBusy(true);
    setErr(null);
    try {
      const saved = await apiFetch<{ sellerReply: string; repliedAt: string }>(
        `/reviews/${r.id}/reply`,
        {
          method: 'POST',
          body: JSON.stringify({ text }),
        },
      );
      setData(
        (d) =>
          d && {
            ...d,
            items: d.items.map((x) =>
              x.id === r.id
                ? { ...x, sellerReply: saved.sellerReply, repliedAt: saved.repliedAt }
                : x,
            ),
            counts: {
              ...d.counts,
              unanswered: r.sellerReply
                ? d.counts.unanswered
                : Math.max(d.counts.unanswered - 1, 0),
            },
          },
      );
      setReplyFor(null);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось сохранить ответ.')));
    } finally {
      setBusy(false);
    }
  }

  const counts = data?.counts;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(t.locale, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Отзывы')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t(
            'Отзывы покупателей о вас и ваши отзывы о продавцах. Ответ на отзыв видят все покупатели в вашем профиле.',
          )}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="chip"
          aria-pressed={tab === 'received'}
          onClick={() => go('received', 'auto')}
        >
          {t('Полученные')}
          {!!counts?.received && <span className="notif-group-count">{counts.received}</span>}
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={tab === 'written'}
          onClick={() => go('written', 'auto')}
        >
          {t('Оставленные')}
          {!!counts?.written && <span className="notif-group-count">{counts.written}</span>}
        </button>
        {tab === 'received' && (
          <label className="row" style={{ gap: 8, fontSize: 14, marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={filter === 'open' || (filter === 'auto' && openShown)}
              disabled={data === null}
              onChange={(e) => go('received', e.target.checked ? 'open' : 'all')}
            />
            {t('Без ответа')}
            {!!counts?.unanswered && <span className="notif-group-count">{counts.unanswered}</span>}
          </label>
        )}
      </div>

      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}

      {data === null ? (
        !err && <div className="skeleton" style={{ height: 280 }} aria-busy="true" />
      ) : data.items.length === 0 ? (
        <div className="card flat empty-state">
          <p className="muted" style={{ maxWidth: '60ch', margin: 0 }}>
            {tab === 'written'
              ? t(
                  'Вы ещё не оставляли отзывов. Оценить продавца можно на странице заказа после подтверждения получения.',
                )
              : openShown
                ? t('На все отзывы вы уже ответили.')
                : t('Отзывов о вас пока нет. Они появятся после завершённых продаж.')}
          </p>
        </div>
      ) : (
        <div className="card notif-list">
          {data.items.map((r) => (
            <article key={r.id} className="review-row">
              <div
                className="row"
                style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}
              >
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Stars n={r.rating} size={15} />
                  <span className="review-who">
                    {tab === 'written'
                      ? t('продавцу {name}', { name: r.counterpart ?? '—' })
                      : t('от {name}', { name: r.counterpart ?? '—' })}{' '}
                    · {date(r.createdAt)}
                    {r.editedAt && ` · ${t('изменён')}`}
                  </span>
                </div>
                <Link href={`/orders/${r.order.id}`} className="review-order">
                  {r.order.title ?? r.order.publicNumber}
                </Link>
              </div>
              {r.comment && <p className="review-text">{r.comment}</p>}
              <ReviewPhotos images={r.images} />
              {r.sellerReply && replyFor !== r.id && (
                <p className="review-reply">
                  <span className="faint">
                    {tab === 'written' ? t('Ответ продавца:') : t('Ваш ответ:')}
                  </span>{' '}
                  {r.sellerReply}
                </p>
              )}
              {tab === 'received' &&
                (replyFor === r.id ? (
                  <div className="stack" style={{ gap: 8, marginTop: 4 }}>
                    <textarea
                      className="input"
                      rows={3}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      aria-label={t('Ответ на отзыв')}
                      placeholder={t('Ответ увидят все покупатели. Контакты скроются.')}
                      style={{ resize: 'vertical' }}
                      autoFocus
                    />
                    <div className="row" style={{ gap: 8 }}>
                      <button
                        className="btn"
                        type="button"
                        disabled={busy || !text.trim()}
                        onClick={() => void sendReply(r)}
                      >
                        {t('Опубликовать ответ')}
                      </button>
                      <button className="btn ghost" type="button" onClick={() => setReplyFor(null)}>
                        {t('Отмена')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        setText(r.sellerReply ?? '');
                        setReplyFor(r.id);
                      }}
                    >
                      {r.sellerReply ? t('Изменить ответ') : t('Ответить на отзыв')}
                    </button>
                  </div>
                ))}
              {tab === 'written' && r.editable && r.editableUntil && (
                <p className="faint" style={{ fontSize: 13, margin: 0 }}>
                  <Link href={`/orders/${r.order.id}`}>{t('Изменить отзыв')}</Link>{' '}
                  {t('можно до {date}', { date: date(r.editableUntil) })}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {data?.more && (
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => void more()}
          style={{ alignSelf: 'center' }}
        >
          {busy ? '…' : t('Показать ещё')}
        </button>
      )}
    </div>
  );
}

export default function ReviewsPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <ReviewsInner />
    </Suspense>
  );
}
