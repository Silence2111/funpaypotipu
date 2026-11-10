'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, KeyRound, AlertTriangle, CheckCircle2, Package } from 'lucide-react';
import { apiFetch, getToken, useSession } from '@/lib/session';
import { formatPrice, formatQty, perPackLabel } from '@/lib/format';
import { apiErrorMessage } from '@/lib/errors';
import { OrderChat } from '@/components/order-chat';
import { OrderReview } from '@/components/order-review';
import { BuyAgain } from '@/components/buy-again';
import { BuyerRating } from '@/components/buyer-rating';
import { PayMethods, priceFor, type PayMethod } from '@/components/pay-methods';
import { payOrder } from '@/lib/checkout';
import { useT } from '@/lib/i18n/client';
import { msg, type T } from '@/lib/i18n/lang';

interface Order {
  id: string; publicNumber: string; status: string; amount: string; currency: string;
  buyerId: string; sellerId: string; fulfillmentType: string;
  listingId?: string; qty?: number;
  /** Чем оплачен и сколько сверху взял способ оплаты (карта +4.4%). */
  paymentMethod?: string | null; paymentSurcharge?: string;
  listingSnapshot?: {
    title?: string; account?: string; topupAmount?: string;
    /** Поштучно: единица и цена пачки на момент заказа. */
    unitName?: string; unitPrice?: string; pricePerUnits?: number;
    /** Ответы покупателя на поля лота: ник, сервер. */
    buyerData?: Array<{ label: string; value: string }>;
    /** «item» — автовыдача аккаунта или предмета со склада, а не ключ. */
    goods?: string;
    /** Промокод продавца: скидка за его счёт, уже в сумме заказа. */
    sellerPromo?: { code: string; percent: number; discount: string };
    qtyDiscount?: { from: number; pct: number; discount: string };
  } | null;
  autoConfirmAt?: string | null; sellerPayoutAmount?: string;
  /** Диалог сделки — приходит с заказом, а не поиском по списку мессенджера. */
  conversationId?: string | null;
}

const STATUS: Record<string, string> = {
  created: msg('Ждёт оплаты'), paid: msg('Оплачен, деньги у площадки'), delivered: msg('Выдан, идёт проверка'),
  completed: msg('Завершён'), disputed: msg('Спор'), refunded: msg('Деньги возвращены'), cancelled: msg('Отменён'),
  expired: msg('Истёк без оплаты'),
};

const STEP_OF: Record<string, number> = { created: 0, paid: 1, delivered: 2, disputed: 2, completed: 3 };

const PAID_BY: Record<string, string> = {
  balance: msg('с баланса'), sbp: msg('по СБП'), card: msg('картой'), applepay: msg('через Apple Pay'),
  googlepay: msg('через Google Pay'), crypto: msg('криптовалютой'),
};

const STEPS = [msg('Оплачен'), msg('Выдан'), msg('Подтверждён')];

type Kind = 'key' | 'item' | 'topup' | 'manual';

/** Что сейчас происходит и что делать — отдельно для покупателя и продавца. */
function explain(t: T, status: string, role: 'buyer' | 'seller', kind: Kind, confirmUntil: string | null) {
  const until = confirmUntil ? new Date(confirmUntil).toLocaleString(t.locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
  const autoConfirm = until ? ` ${t('Если не подтвердите и не откроете спор до {until}, заказ подтвердится сам.', { until })}` : '';
  if (role === 'buyer') {
    switch (status) {
      case 'created': return t('Заказ создан, но не оплачен. Без оплаты он истечёт через 30 минут.');
      case 'paid': return kind === 'key'
        ? t('Оплата получена, ключ выдаётся. Обновите страницу через пару секунд.')
        : kind === 'item'
          ? t('Оплата получена, товар выдаётся. Обновите страницу через пару секунд.')
          : kind === 'topup'
            ? t('Оплата получена, пополнение отправляется. Обновите страницу через пару секунд.')
            : t('Оплата у площадки, продавец её не получит до вашего подтверждения. Ждём, когда он передаст товар; напишите ему в чат ниже. Не выдаст за 24 ч — деньги вернутся на баланс.');
      case 'delivered': return kind === 'topup'
        ? t('Пополнение отправлено. Проверьте баланс и подтвердите зачисление — тогда продавец получит оплату. Не пришло — откройте спор.') + autoConfirm
        : t('Товар выдан. Проверьте его и подтвердите получение — тогда продавец получит оплату.') + autoConfirm;
      case 'completed': return t('Сделка закрыта: продавец получил оплату, кэшбэк зачислен на ваш баланс.');
      case 'disputed': return t('Открыт спор. Деньги заморожены, пока арбитр не примет решение.');
      case 'refunded': return t('Деньги вернулись на ваш баланс на площадке.');
      default: return '';
    }
  }
  switch (status) {
    case 'paid': return kind === 'manual'
      ? t('Покупатель оплатил, деньги у площадки. Передайте товар и нажмите «Отметить выдачу» — у вас 24 ч.')
      : t('Покупатель оплатил, деньги у площадки. Выдача идёт автоматически.');
    case 'delivered': return `${kind === 'manual' ? t('Вы отметили выдачу.') : t('Выдано автоматически.')} ${t('Деньги придут на баланс, когда покупатель подтвердит получение или истечёт срок проверки.')}`;
    case 'completed': return t('Сделка закрыта, оплата зачислена на ваш баланс.');
    case 'disputed': return t('Покупатель открыл спор. Ответьте в споре и приложите доказательства передачи — или верните деньги сами.');
    case 'refunded': return t('Деньги вернулись покупателю на баланс. Сделка закрыта.');
    default: return '';
  }
}

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const t = useT();
  const [order, setOrder] = useState<Order | null>(null);
  const [keys, setKeys] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [reason, setReason] = useState('');
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>('sbp');
  const [payFailed, setPayFailed] = useState(false);
  // Вернулись со страницы платёжного шлюза: оплату подтверждает его вебхук,
  // поэтому несколько секунд заказ может ещё ждать оплаты.
  const [returned, setReturned] = useState<'waiting' | 'slow' | null>(null);

  const { ready, token, user: me } = useSession();

  const loadOrder = useCallback(async () => {
    setOrder(await apiFetch<Order>(`/orders/${id}`));
  }, [id]);

  useEffect(() => {
    if (!getToken()) return;
    loadOrder().catch(() => setErr(t('Заказ не найден')));
  }, [loadOrder, t]);

  // Оформление с лота: заказ создан, а оплата не прошла — платим отсюда.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setPayFailed(q.get('pay') === 'failed');
    if (q.get('paid') === '1') setReturned('waiting');
  }, []);

  // После шлюза — спрашиваем заказ, пока оплата не дойдёт; две минуты, не дольше.
  const waitingPay = returned === 'waiting' && order?.status === 'created';
  useEffect(() => {
    if (!waitingPay) return;
    const timer = setInterval(() => void loadOrder().catch(() => {}), 3000);
    const stop = setTimeout(() => setReturned('slow'), 120_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [waitingPay, loadOrder]);

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
      setErr(apiErrorMessage(e, t('Не получилось. Обновите страницу — возможно, статус заказа уже изменился.')));
    } finally {
      setBusy(false);
    }
  }

  async function openDispute() {
    if (reason.trim().length < 3) {
      setErr(t('Опишите проблему: что не так с товаром или передачей'));
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
      setErr(apiErrorMessage(e, t('Не удалось открыть спор. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setErr(null);
    setBusy(true);
    try {
      // Шлюз с переходом — страница уходит на его оплату и вернётся с ?paid=1.
      if ((await payOrder(id, method)) === 'redirect') return;
      setPayFailed(false);
      await loadOrder();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Оплата не прошла. Выберите другой способ или попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  /** Продавец возвращает деньги сам — после оплаты, после выдачи или в споре. */
  async function refund() {
    const reason = window.prompt(
      `${t('Вернуть всю сумму покупателю на баланс? Отменить возврат будет нельзя.')}\n${t('Причину увидит покупатель — можно оставить пустой.')}`,
      '',
    );
    if (reason === null) return;
    setErr(null);
    setBusy(true);
    try {
      await apiFetch(`/orders/${id}/refund`, {
        method: 'POST',
        body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
      });
      await loadOrder();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось вернуть деньги. Обновите страницу — возможно, статус заказа уже изменился.')));
    } finally {
      setBusy(false);
    }
  }

  async function revealKey() {
    try {
      const r = await apiFetch<{ key: string; keys?: string[] }>(`/orders/${id}/key`);
      setKeys(r.keys ?? [r.key]);
    } catch {
      setErr(t('Ключ ещё не выдан'));
    }
  }

  if (!ready)
    return (
      <div className="container" style={{ paddingTop: 48, maxWidth: 720 }} aria-busy="true" aria-label={t('Загружаем заказ')}>
        <div className="skeleton" style={{ height: 32, width: '60%' }} />
        <div className="skeleton" style={{ height: 120, marginTop: 24 }} />
      </div>
    );
  if (!token)
    return (
      <div className="container" style={{ padding: '48px 16px', maxWidth: 720 }}>
        <div className="card" style={{ padding: 24 }}>
          <p style={{ margin: '0 0 12px' }}>{t('Заказ виден только его участникам. Войдите, чтобы открыть его.')}</p>
          <Link href={`/login?next=${encodeURIComponent(`/orders/${id}`)}`} className="btn">{t('Войти')}</Link>
        </div>
      </div>
    );
  if (!order)
    return (
      <div className="container" style={{ paddingTop: 48, maxWidth: 720 }}>
        {err ? (
          <div className="card" style={{ padding: 24 }}>
            <p style={{ margin: '0 0 12px' }}>{t('Заказ не найден или он не ваш.')}</p>
            <Link href="/cabinet" className="btn secondary">{t('В кабинет')}</Link>
          </div>
        ) : (
          <div aria-busy="true" aria-label={t('Загружаем заказ')}>
            <div className="skeleton" style={{ height: 32, width: '60%' }} />
            <div className="skeleton" style={{ height: 28, width: 140, marginTop: 16 }} />
            <div className="skeleton" style={{ height: 120, marginTop: 24 }} />
          </div>
        )}
      </div>
    );

  const role = me?.id === order.buyerId ? 'buyer' : 'seller';
  const auto = order.fulfillmentType === 'auto_key';
  // Автовыдача аккаунта или предмета — «товар», у ключей — «ключ».
  const kind: Kind = auto
    ? order.listingSnapshot?.goods === 'item' ? 'item' : 'key'
    : order.fulfillmentType === 'provider' ? 'topup' : 'manual';
  const many = (order.qty ?? 1) > 1;
  const step = STEP_OF[order.status] ?? -1;
  const closed = ['refunded', 'cancelled', 'expired'].includes(order.status);
  const text = explain(t, order.status, role, kind, order.autoConfirmAt ?? null);
  const title = order.listingSnapshot?.title;
  const topupAccount = order.listingSnapshot?.account;
  const topupAmount = order.listingSnapshot?.topupAmount;
  const unit = order.listingSnapshot?.unitName;
  const unitPrice = order.listingSnapshot?.unitPrice;
  const pack = unit ? perPackLabel({ unitName: unit, pricePerUnits: order.listingSnapshot?.pricePerUnits }, t) : null;

  return (
    <div className="container" style={{ paddingTop: 40, maxWidth: 720 }}>
      <p className="faint" style={{ fontSize: 13, margin: 0 }}>
        {role === 'buyer'
          ? t('Заказ {n} · вы покупатель', { n: order.publicNumber })
          : t('Заказ {n} · вы продавец', { n: order.publicNumber })}
      </p>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 6 }}>
        <h1 className="h2" style={{ lineHeight: 1.25 }}>
          {title && order.listingId ? <Link href={`/lot/${order.listingId}`}>{title}</Link> : title ?? t('Заказ')}
        </h1>
        <div className="price" style={{ fontSize: 22, whiteSpace: 'nowrap' }}>{formatPrice(order.amount, order.currency, t)}</div>
      </div>
      {order.listingSnapshot?.qtyDiscount && (
        <p className="faint" style={{ fontSize: 13, margin: '4px 0 0', textAlign: 'right' }}>
          {t('Скидка за количество {pct}%: −{sum}', {
            pct: order.listingSnapshot.qtyDiscount.pct,
            sum: formatPrice(order.listingSnapshot.qtyDiscount.discount, order.currency, t),
          })}
        </p>
      )}
      {order.listingSnapshot?.sellerPromo && (
        <p className="faint" style={{ fontSize: 13, margin: '4px 0 0', textAlign: 'right' }}>
          {t('Промокод продавца {code}: −{sum}', {
            code: order.listingSnapshot.sellerPromo.code,
            sum: formatPrice(order.listingSnapshot.sellerPromo.discount, order.currency, t),
          })}
        </p>
      )}
      {role === 'buyer' && order.paymentMethod && (
        <p className="faint" style={{ fontSize: 13, margin: '4px 0 0', textAlign: 'right' }}>
          {t('Оплачено {method}', { method: PAID_BY[order.paymentMethod] ? t(PAID_BY[order.paymentMethod]!) : order.paymentMethod })}
          {order.paymentSurcharge && order.paymentSurcharge !== '0'
            ? ` — ${t('{sum} с комиссией способа', { sum: formatPrice((BigInt(order.amount) + BigInt(order.paymentSurcharge)).toString(), order.currency, t) })}`
            : ''}
        </p>
      )}
      {returned === 'waiting' && order.status === 'created' && (
        <div className="alert" role="status" style={{ marginTop: 16 }}>
          {t('Проверяем оплату — обычно это несколько секунд. Страница обновится сама.')}
        </div>
      )}
      {returned === 'slow' && order.status === 'created' && (
        <div className="alert" role="status" style={{ marginTop: 16 }}>
          {t('Банк ещё не подтвердил оплату. Если деньги списаны, заказ оплатится сам, как только подтверждение придёт. Если нет — выберите способ ниже и оплатите снова.')}
        </div>
      )}
      {payFailed && order.status === 'created' && (
        <div className="alert error" role="alert" style={{ marginTop: 16 }}>
          {t('Оплата не прошла. Заказ создан — выберите способ ниже и попробуйте ещё раз.')}
        </div>
      )}

      <div className="card" style={{ marginTop: 20, padding: 20 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span className={
            order.status === 'completed' ? 'badge success'
              : order.status === 'disputed' ? 'badge warning'
                : closed ? 'badge' : 'badge accent'}>
            {STATUS[order.status] ? t(STATUS[order.status]!) : order.status}
          </span>
          <span className="row faint" style={{ gap: 6, fontSize: 13 }}>
            <ShieldCheck size={15} strokeWidth={1.75} /> {t('Защита сделки')}
          </span>
        </div>
        {!closed && (
          <ol className="steps" style={{ marginTop: 16 }} aria-label={t('Этапы сделки')}>
            {STEPS.map((s, i) => (
              <li key={s} className={i + 1 < step || (i + 1 === step && order.status === 'completed') ? 'done' : i + 1 === step ? 'now' : ''}>
                {t(s)}
              </li>
            ))}
          </ol>
        )}
        {/* «1 шт.» у обычного ключа — шум; количество важно у валюты и нескольких штук */}
        {unit && order.qty != null && (order.qty > 1 || unit !== 'шт.') && ( // i18n-ignore
          <p style={{ margin: '14px 0 0', fontSize: 15 }}>
            <strong>{formatQty(order.qty, unit, t)}</strong>
            {unitPrice && pack && (
              <span className="faint"> · {formatPrice(unitPrice, order.currency, t)} {pack}</span>
            )}
          </p>
        )}
        {order.listingSnapshot?.buyerData && order.listingSnapshot.buyerData.length > 0 && (
          <dl style={{ margin: '14px 0 0', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', fontSize: 15 }}>
            {order.listingSnapshot.buyerData.map((a) => (
              <div key={a.label} style={{ display: 'contents' }}>
                <dt className="faint">{a.label}</dt>
                <dd style={{ margin: 0, fontWeight: 600, wordBreak: 'break-word' }}>{a.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {kind === 'topup' && topupAccount && (
          <p style={{ margin: '14px 0 0', fontSize: 15 }}>
            {topupAmount
              ? t('Зачисление {sum} на аккаунт', { sum: formatPrice(topupAmount, order.currency, t) })
              : t('Пополнение на аккаунт')}{' '}
            <strong style={{ wordBreak: 'break-all' }}>{topupAccount}</strong>
          </p>
        )}
        {text && <p style={{ margin: '14px 0 0', fontSize: 15 }} className="muted">{text}</p>}

        {role === 'buyer' && order.status === 'created' && (
          <div style={{ marginTop: 16, maxWidth: 440 }}>
            <PayMethods base={BigInt(order.amount)} currency={order.currency} value={method} onChange={setMethod} />
          </div>
        )}

        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          {role === 'buyer' && order.status === 'created' && (
            <button className="btn" onClick={pay} disabled={busy} type="button">
              {t('Оплатить {sum}', { sum: formatPrice(priceFor(BigInt(order.amount), method).toString(), order.currency, t) })}
            </button>
          )}
          {role === 'seller' && order.status === 'paid' && (
            <button className="btn" onClick={() => act('deliver')} disabled={busy} type="button">{t('Отметить выдачу')}</button>
          )}
          {role === 'buyer' && auto && (order.status === 'delivered' || order.status === 'completed') && !keys && (
            <button className={order.status === 'delivered' ? 'btn secondary' : 'btn'} onClick={revealKey} type="button">
              {kind === 'item' ? <Package size={16} strokeWidth={1.75} /> : <KeyRound size={16} strokeWidth={1.75} />}{' '}
              {kind === 'item' ? t('Показать товар') : many ? t('Показать ключи') : t('Показать ключ')}
            </button>
          )}
          {role === 'buyer' && order.status === 'delivered' && (
            <button className="btn" onClick={() => act('confirm')} disabled={busy} type="button">
              <CheckCircle2 size={16} /> {t('Всё получил, подтвердить')}
            </button>
          )}
          {role === 'buyer' && (order.status === 'paid' || order.status === 'delivered') && (
            <button className="btn secondary" onClick={() => setShowDispute((v) => !v)} type="button">
              <AlertTriangle size={16} strokeWidth={1.75} /> {t('Открыть спор')}
            </button>
          )}
          {order.status === 'paid' && role === 'buyer' && (
            <button className="btn ghost" disabled={busy} type="button"
              onClick={() => {
                if (window.confirm(t('Отменить заказ? Деньги вернутся на ваш баланс.'))) act('cancel');
              }}>
              {t('Отменить заказ')}
            </button>
          )}
          {role === 'buyer' && order.listingId && (order.status === 'completed' || closed) && (
            <BuyAgain
              listingId={order.listingId}
              qty={order.qty}
              account={topupAccount}
              topupAmount={topupAmount}
            />
          )}
          {role === 'seller' && ['paid', 'delivered', 'disputed'].includes(order.status) && (
            <button className="btn ghost" disabled={busy} type="button" onClick={refund}>
              {t('Вернуть деньги покупателю')}
            </button>
          )}
        </div>

        {keys && (
          <div className="card flat" style={{ marginTop: 16, padding: 16, background: 'var(--page)' }}>
            <p className="hint" style={{ marginBottom: 6 }}>
              {kind === 'item'
                ? keys.length > 1 ? t('Ваш товар · {n} шт.', { n: keys.length }) : t('Ваш товар')
                : keys.length > 1 ? t('Ваши ключи · {n}', { n: keys.length }) : t('Ваш ключ')}
            </p>
            <ol style={{ margin: 0, paddingLeft: keys.length > 1 ? 22 : 0, listStyle: keys.length > 1 ? 'decimal' : 'none', display: 'grid', gap: 6 }}>
              {keys.map((k, i) => (
                <li key={i}>
                  <code style={{ fontSize: 16, fontWeight: 600, wordBreak: 'break-all' }}>{k}</code>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {showDispute && (
        <div className="card" style={{ marginTop: 16, padding: 20 }}>
          <div className="field">
            <label className="label" htmlFor="dispute-reason">{t('Что пошло не так')}</label>
            <textarea id="dispute-reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={kind === 'item'
                ? t('Например: пароль не подходит, аккаунт не соответствует описанию')
                : t('Например: ключ уже активирован, пишет «код использован»')}
              style={{ resize: 'vertical' }} />
            <p className="hint">{t('Спор рассмотрит арбитр площадки. Деньги заморожены до решения.')}</p>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={openDispute} disabled={busy} type="button">{t('Открыть спор')}</button>
            <button className="btn ghost" onClick={() => setShowDispute(false)} type="button">{t('Не сейчас')}</button>
          </div>
        </div>
      )}

      {order.status === 'disputed' && disputeId && (
        <Link href={`/disputes/${disputeId}`} className="btn secondary" style={{ marginTop: 16 }}>
          {t('Перейти к спору')}
        </Link>
      )}

      {order.status === 'completed' && <OrderReview orderId={id} role={role} />}
      <BuyerRating orderId={id} role={role} />

      {err && <div className="alert error" role="alert" style={{ marginTop: 16 }}>{err}</div>}

      <p className="hint" style={{ marginTop: 16 }}>
        {t('Вопрос не к продавцу, а к площадке?')}{' '}
        <Link href={`/cabinet/support?order=${order.id}`}>{t('Написать в поддержку')}</Link>
      </p>

      <section style={{ marginTop: 40 }}>
        <h2 className="h2" style={{ fontSize: 18, marginBottom: 12 }}>{t('Чат по сделке')}</h2>
        {order.conversationId && me ? (
          <OrderChat conversationId={order.conversationId} meId={me.id} />
        ) : (
          <p className="muted" style={{ fontSize: 14 }}>
            {t('Чат откроется, когда заказ будет оплачен. Всё, что написано в нём, увидит арбитр при споре.')}
          </p>
        )}
      </section>
    </div>
  );
}
