'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, KeyRound, Star, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiFetch, getToken, getUser } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { apiErrorMessage } from '@/lib/errors';
import { OrderChat } from '@/components/order-chat';

interface Order {
  id: string; publicNumber: string; status: string; amount: string; currency: string;
  buyerId: string; sellerId: string; fulfillmentType: string;
  listingId?: string;
  listingSnapshot?: { title?: string; account?: string; topupAmount?: string } | null;
  autoConfirmAt?: string | null; sellerPayoutAmount?: string;
}
interface Conversation { id: string; orderId: string | null }

const STATUS_RU: Record<string, string> = {
  created: 'Ждёт оплаты', paid: 'Оплачен, деньги у площадки', delivered: 'Выдан, идёт проверка',
  completed: 'Завершён', disputed: 'Спор', refunded: 'Деньги возвращены', cancelled: 'Отменён',
  expired: 'Истёк без оплаты',
};

const STEP_OF: Record<string, number> = { created: 0, paid: 1, delivered: 2, disputed: 2, completed: 3 };

type Kind = 'key' | 'topup' | 'manual';

/** Что сейчас происходит и что делать — отдельно для покупателя и продавца. */
function explain(status: string, role: 'buyer' | 'seller', kind: Kind, confirmUntil: string | null) {
  const until = confirmUntil ? new Date(confirmUntil).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
  const autoConfirm = until ? ` Если не подтвердите и не откроете спор до ${until}, заказ подтвердится сам.` : '';
  if (role === 'buyer') {
    switch (status) {
      case 'created': return 'Заказ создан, но не оплачен. Без оплаты он истечёт через 30 минут.';
      case 'paid': return kind === 'key'
        ? 'Оплата получена, ключ выдаётся. Обновите страницу через пару секунд.'
        : kind === 'topup'
          ? 'Оплата получена, пополнение отправляется. Обновите страницу через пару секунд.'
          : 'Оплата у площадки, продавец её не получит до вашего подтверждения. Ждём, когда он передаст товар; напишите ему в чат ниже. Не выдаст за 24 ч — деньги вернутся на баланс.';
      case 'delivered': return kind === 'topup'
        ? `Пополнение отправлено. Проверьте баланс и подтвердите зачисление — тогда продавец получит оплату. Не пришло — откройте спор.${autoConfirm}`
        : `Товар выдан. Проверьте его и подтвердите получение — тогда продавец получит оплату.${autoConfirm}`;
      case 'completed': return 'Сделка закрыта: продавец получил оплату, кэшбэк зачислен на ваш баланс.';
      case 'disputed': return 'Открыт спор. Деньги заморожены, пока арбитр не примет решение.';
      case 'refunded': return 'Деньги вернулись на ваш баланс на площадке.';
      default: return '';
    }
  }
  switch (status) {
    case 'paid': return kind === 'manual'
      ? 'Покупатель оплатил, деньги у площадки. Передайте товар и нажмите «Отметить выдачу» — у вас 24 ч.'
      : 'Покупатель оплатил, деньги у площадки. Выдача идёт автоматически.';
    case 'delivered': return 'Вы отметили выдачу. Деньги придут на баланс, когда покупатель подтвердит получение или истечёт срок проверки.';
    case 'completed': return 'Сделка закрыта, оплата зачислена на ваш баланс.';
    case 'disputed': return 'Покупатель открыл спор. Ответьте в споре и приложите доказательства передачи.';
    default: return '';
  }
}

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [order, setOrder] = useState<Order | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [reviewDone, setReviewDone] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null);

  const me = getUser();

  const loadOrder = useCallback(async () => {
    setOrder(await apiFetch<Order>(`/orders/${id}`));
  }, [id]);

  const loadConv = useCallback(async () => {
    const convs = await apiFetch<Conversation[]>('/conversations').catch(() => []);
    setConv(convs.find((x) => x.orderId === id) ?? null);
  }, [id]);

  useEffect(() => {
    if (!getToken()) return;
    loadOrder().catch(() => setErr('Заказ не найден'));
    loadConv();
  }, [loadOrder, loadConv]);

  useEffect(() => {
    if (order?.status === 'disputed') {
      apiFetch<{ id: string }>(`/disputes/by-order/${id}`)
        .then((r) => setDisputeId(r.id))
        .catch(() => {});
    }
  }, [order?.status, id]);

  async function act(path: string) {
    setErr(null);
    setBusy(true);
    try {
      await apiFetch(`/orders/${id}/${path}`, { method: 'POST' });
      await loadOrder();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не получилось. Обновите страницу — возможно, статус заказа уже изменился.'));
    } finally {
      setBusy(false);
    }
  }

  async function openDispute() {
    if (reason.trim().length < 3) {
      setErr('Опишите проблему: что не так с товаром или передачей');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const created = await apiFetch<{ id: string }>('/disputes', {
        method: 'POST',
        body: JSON.stringify({ orderId: id, reason: reason.trim() }),
      });
      setShowDispute(false);
      setReason('');
      router.push(`/disputes/${created.id}`);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось открыть спор. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitReview() {
    if (rating < 1) {
      setErr('Поставьте оценку');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await apiFetch('/reviews', {
        method: 'POST',
        body: JSON.stringify({ orderId: id, rating, comment: comment.trim() || undefined }),
      });
      setReviewDone(true);
    } catch {
      setNote('Отзыв по этому заказу уже оставлен.');
      setReviewDone(true);
    } finally {
      setBusy(false);
    }
  }

  async function revealKey() {
    try {
      const r = await apiFetch<{ key: string }>(`/orders/${id}/key`);
      setKey(r.key);
    } catch {
      setErr('Ключ ещё не выдан');
    }
  }

  if (!getToken())
    return (
      <div className="container" style={{ padding: '48px 16px', maxWidth: 720 }}>
        <div className="card" style={{ padding: 24 }}>
          <p style={{ margin: '0 0 12px' }}>Заказ виден только его участникам. Войдите, чтобы открыть его.</p>
          <Link href={`/login?next=${encodeURIComponent(`/orders/${id}`)}`} className="btn">Войти</Link>
        </div>
      </div>
    );
  if (!order)
    return (
      <div className="container" style={{ paddingTop: 48, maxWidth: 720 }}>
        {err ? (
          <div className="card" style={{ padding: 24 }}>
            <p style={{ margin: '0 0 12px' }}>Заказ не найден или он не ваш.</p>
            <Link href="/cabinet" className="btn secondary">В кабинет</Link>
          </div>
        ) : (
          <div aria-busy="true" aria-label="Загружаем заказ">
            <div className="skeleton" style={{ height: 32, width: '60%' }} />
            <div className="skeleton" style={{ height: 28, width: 140, marginTop: 16 }} />
            <div className="skeleton" style={{ height: 120, marginTop: 24 }} />
          </div>
        )}
      </div>
    );

  const role = me?.id === order.buyerId ? 'buyer' : 'seller';
  const auto = order.fulfillmentType === 'auto_key';
  const kind: Kind = auto ? 'key' : order.fulfillmentType === 'provider' ? 'topup' : 'manual';
  const step = STEP_OF[order.status] ?? -1;
  const closed = ['refunded', 'cancelled', 'expired'].includes(order.status);
  const text = explain(order.status, role, kind, order.autoConfirmAt ?? null);
  const title = order.listingSnapshot?.title;
  const topupAccount = order.listingSnapshot?.account;
  const topupAmount = order.listingSnapshot?.topupAmount;

  return (
    <div className="container" style={{ paddingTop: 40, maxWidth: 720 }}>
      <p className="faint" style={{ fontSize: 13, margin: 0 }}>
        Заказ {order.publicNumber} · вы {role === 'buyer' ? 'покупатель' : 'продавец'}
      </p>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 6 }}>
        <h1 className="h2" style={{ lineHeight: 1.25 }}>
          {title && order.listingId ? <Link href={`/lot/${order.listingId}`}>{title}</Link> : title ?? 'Заказ'}
        </h1>
        <div className="price" style={{ fontSize: 22, whiteSpace: 'nowrap' }}>{formatPrice(order.amount, order.currency)}</div>
      </div>

      <div className="card" style={{ marginTop: 20, padding: 20 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span className={
            order.status === 'completed' ? 'badge success'
              : order.status === 'disputed' ? 'badge warning'
                : closed ? 'badge' : 'badge accent'}>
            {STATUS_RU[order.status] ?? order.status}
          </span>
          <span className="row faint" style={{ gap: 6, fontSize: 13 }}>
            <ShieldCheck size={15} strokeWidth={1.75} /> Защита сделки
          </span>
        </div>
        {!closed && (
          <ol className="steps" style={{ marginTop: 16 }} aria-label="Этапы сделки">
            {['Оплачен', 'Выдан', 'Подтверждён'].map((t, i) => (
              <li key={t} className={i + 1 < step || (i + 1 === step && order.status === 'completed') ? 'done' : i + 1 === step ? 'now' : ''}>
                {t}
              </li>
            ))}
          </ol>
        )}
        {kind === 'topup' && topupAccount && (
          <p style={{ margin: '14px 0 0', fontSize: 15 }}>
            {topupAmount ? <>Зачисление {formatPrice(topupAmount, order.currency)} на аккаунт </> : <>Пополнение на аккаунт </>}
            <strong style={{ wordBreak: 'break-all' }}>{topupAccount}</strong>
          </p>
        )}
        {text && <p style={{ margin: '14px 0 0', fontSize: 15 }} className="muted">{text}</p>}

        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          {role === 'buyer' && order.status === 'created' && (
            <button className="btn" onClick={() => act('pay-from-balance')} disabled={busy} type="button">
              Оплатить с баланса
            </button>
          )}
          {role === 'seller' && order.status === 'paid' && (
            <button className="btn" onClick={() => act('deliver')} disabled={busy} type="button">Отметить выдачу</button>
          )}
          {role === 'buyer' && auto && (order.status === 'delivered' || order.status === 'completed') && !key && (
            <button className={order.status === 'delivered' ? 'btn secondary' : 'btn'} onClick={revealKey} type="button">
              <KeyRound size={16} /> Показать ключ
            </button>
          )}
          {role === 'buyer' && order.status === 'delivered' && (
            <button className="btn" onClick={() => act('confirm')} disabled={busy} type="button">
              <CheckCircle2 size={16} /> Всё получил, подтвердить
            </button>
          )}
          {role === 'buyer' && (order.status === 'paid' || order.status === 'delivered') && (
            <button className="btn secondary" onClick={() => setShowDispute((v) => !v)} type="button">
              <AlertTriangle size={16} strokeWidth={1.75} /> Открыть спор
            </button>
          )}
          {order.status === 'paid' && (
            <button className="btn ghost" disabled={busy} type="button"
              onClick={() => {
                if (window.confirm(role === 'buyer'
                  ? 'Отменить заказ? Деньги вернутся на ваш баланс.'
                  : 'Отменить заказ? Деньги вернутся покупателю.')) act('cancel');
              }}>
              Отменить заказ
            </button>
          )}
        </div>

        {key && (
          <div className="card flat" style={{ marginTop: 16, padding: 16, background: 'var(--page)' }}>
            <p className="hint" style={{ marginBottom: 6 }}>Ваш ключ</p>
            <code style={{ fontSize: 16, fontWeight: 600, wordBreak: 'break-all' }}>{key}</code>
          </div>
        )}
      </div>

      {showDispute && (
        <div className="card" style={{ marginTop: 16, padding: 20 }}>
          <div className="field">
            <label className="label" htmlFor="dispute-reason">Что пошло не так</label>
            <textarea id="dispute-reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Например: ключ уже активирован, пишет «код использован»" style={{ resize: 'vertical' }} />
            <p className="hint">Спор рассмотрит арбитр площадки. Деньги заморожены до решения.</p>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={openDispute} disabled={busy} type="button">Открыть спор</button>
            <button className="btn ghost" onClick={() => setShowDispute(false)} type="button">Не сейчас</button>
          </div>
        </div>
      )}

      {order.status === 'disputed' && disputeId && (
        <Link href={`/disputes/${disputeId}`} className="btn secondary" style={{ marginTop: 16 }}>
          Перейти к спору
        </Link>
      )}

      {role === 'buyer' && order.status === 'completed' && !reviewDone && (
        <div className="card" style={{ marginTop: 16, padding: 20 }}>
          <div className="label" style={{ marginBottom: 8 }}>Оцените продавца</div>
          <div className="row" style={{ gap: 4 }} role="radiogroup" aria-label="Оценка">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} из 5`} aria-pressed={n === rating}
                style={{ background: 'none', border: 0, cursor: 'pointer', padding: 10, lineHeight: 0 }}>
                <Star size={24} strokeWidth={1.75}
                  fill={n <= rating ? '#E8A317' : 'none'} color={n <= rating ? '#E8A317' : 'var(--fg-faint)'} />
              </button>
            ))}
          </div>
          <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Что понравилось, что нет — необязательно" style={{ resize: 'vertical', marginTop: 10 }} />
          <button className="btn" onClick={submitReview} disabled={busy} type="button" style={{ marginTop: 12 }}>
            Оставить отзыв
          </button>
        </div>
      )}
      {reviewDone && <div className="alert success" style={{ marginTop: 16 }}>{note ?? 'Спасибо, отзыв опубликован.'}</div>}

      {err && <div className="alert error" role="alert" style={{ marginTop: 16 }}>{err}</div>}

      <section style={{ marginTop: 40 }}>
        <h2 className="h2" style={{ fontSize: 18, marginBottom: 12 }}>Чат по сделке</h2>
        {conv && me ? (
          <OrderChat conversationId={conv.id} meId={me.id} />
        ) : (
          <p className="muted" style={{ fontSize: 14 }}>
            Чат откроется, когда заказ будет оплачен. Всё, что написано в нём, увидит арбитр при споре.
          </p>
        )}
      </section>
    </div>
  );
}
