'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Megaphone, Send } from 'lucide-react';
import {
  BUY_REQUEST_DAYS,
  BUY_REQUEST_TEXT_MAX,
  BUY_REQUEST_TEXT_MIN,
} from '@gamemarket/shared/buy-request';
import { apiFetch, getToken, useSession } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';

const toLogin = () => `/login?next=${encodeURIComponent(location.pathname + location.search)}`;

/**
 * «Оставить запрос» в разделе: что ищете и до какой цены. Продавцам раздела
 * приходит уведомление, ответы — лотами в «Запросах» кабинета.
 */
export function RequestForm({
  categoryId,
  primary = false,
}: {
  categoryId: string;
  primary?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function start() {
    if (!getToken()) {
      router.push(toLogin());
      return;
    }
    setErr(null);
    setOpen(true);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const what = text.trim();
    if (what.length < BUY_REQUEST_TEXT_MIN) {
      setErr(t('Опишите, что ищете, — от 10 символов'));
      return;
    }
    const rub = price.trim() ? Number(price.replace(/\s/g, '')) : null;
    if (rub !== null && !(Number.isInteger(rub) && rub > 0)) {
      setErr(t('Цена — целым числом рублей больше нуля.'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/buy-requests', {
        method: 'POST',
        body: JSON.stringify({ categoryId, text: what, maxPrice: rub ? rub * 100 : null }),
      });
      setDone(true);
      setOpen(false);
      setText('');
      setPrice('');
      router.refresh();
    } catch (er) {
      setErr(apiErrorMessage(er, t('Не удалось отправить запрос.')));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Link href="/cabinet/requests?tab=mine" className="chip save-search-done">
        <Check size={16} strokeWidth={1.75} aria-hidden />
        {t('Запрос отправлен продавцам раздела — ответы в «Запросах»')}
      </Link>
    );
  }
  if (!open) {
    return (
      <button type="button" className={primary ? 'btn secondary' : 'chip'} onClick={start}>
        <Megaphone size={16} strokeWidth={1.75} aria-hidden />
        {t('Оставить запрос')}
      </button>
    );
  }
  return (
    <form
      className="card save-search"
      onSubmit={send}
      aria-label={t('Оставить запрос')}
      // В пустом разделе форма — внутри центрированной карточки.
      style={{ textAlign: 'left', marginInline: 'auto' }}
    >
      <div className="save-search-title">{t('Что вы ищете?')}</div>
      <p className="hint" style={{ margin: 0 }}>
        {t(
          'Продавцы раздела получат уведомление и предложат свои лоты. Запрос виден {days} дней; контакты в тексте скрываются — договориться можно в чате лота.',
          { days: BUY_REQUEST_DAYS },
        )}
      </p>
      <label className="field">
        <span className="label">{t('Запрос')}</span>
        <textarea
          className="input"
          rows={3}
          maxLength={BUY_REQUEST_TEXT_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Что нужно: параметры, регион, к какому сроку')}
          autoFocus
        />
      </label>
      <label className="field">
        <span className="label">{t('До какой цены, ₽ — необязательно')}</span>
        <input
          className="input save-search-price"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^\d\s]/g, ''))}
          placeholder="1 500"
        />
      </label>
      {err && (
        <div className="field-error" role="alert">
          {err}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn" disabled={busy}>
          {t('Отправить')}
        </button>
        <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
          {t('Отмена')}
        </button>
      </div>
    </form>
  );
}

type Candidate = {
  id: string;
  title: string;
  price: string;
  currency: string;
  offered: boolean;
  withinBudget: boolean;
};

/**
 * «Предложить лот» на запрос: свои лоты в продаже из того же раздела.
 * Лотов нет — «Выставить лот» с игрой и разделом; созданный лот сразу
 * уходит покупателю.
 */
export function OfferLot({
  requestId,
  buyerId,
  sellHref,
  offered = 0,
}: {
  requestId: string;
  /** Автор запроса: себе не предлагают. */
  buyerId: string | null;
  /** Форма нового лота в разделе запроса. */
  sellHref: string;
  /** Уже предложено своих лотов (кабинет знает заранее). */
  offered?: number;
}) {
  const t = useT();
  const router = useRouter();
  const { ready, user } = useSession();
  const [list, setList] = useState<{ left: number; items: Candidate[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sent, setSent] = useState(offered);

  if (!ready || (user && user.id === buyerId)) return null;
  const newLot = `${sellHref}&request=${encodeURIComponent(requestId)}`;

  async function start() {
    if (!getToken()) {
      router.push(toLogin());
      return;
    }
    setOpen(true);
    setMsg(null);
    try {
      const c = await apiFetch<{ left: number; items: Candidate[] }>(
        `/buy-requests/${requestId}/candidates`,
      );
      setList(c);
      setPick(c.items.find((l) => !l.offered)?.id ?? null);
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, t('Не удалось загрузить ваши лоты.')) });
    }
  }

  async function send() {
    if (!pick) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/buy-requests/${requestId}/offers`, {
        method: 'POST',
        body: JSON.stringify({ listingId: pick }),
      });
      setSent((n) => n + 1);
      setList((l) =>
        l
          ? {
              left: l.left - 1,
              items: l.items.map((x) => (x.id === pick ? { ...x, offered: true } : x)),
            }
          : l,
      );
      setMsg({ ok: true, text: t('Лот отправлен покупателю — ему пришла ссылка.') });
      setPick(null);
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, t('Не удалось предложить лот.')) });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button type="button" className="chip" onClick={() => void start()}>
          <Send size={14} strokeWidth={1.75} aria-hidden />
          {t('Предложить лот')}
        </button>
        {sent > 0 && <span className="badge success">{t('Вы предложили: {n}', { n: sent })}</span>}
      </div>
    );
  }
  const free = list?.items.filter((l) => !l.offered) ?? [];
  return (
    <div className="request-offer" role="group" aria-label={t('Предложить лот')}>
      {list === null && !msg && (
        <div className="skeleton" style={{ height: 40 }} aria-busy="true" />
      )}
      {list && list.items.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {t(
            'У вас нет лотов в продаже в этом разделе. Выставьте лот — он сразу уйдёт покупателю.',
          )}
        </p>
      )}
      {list && list.items.length > 0 && (
        <ul className="request-lots">
          {list.items.map((l) => (
            <li key={l.id}>
              <label className="request-lot">
                <input
                  type="radio"
                  name={`offer-${requestId}`}
                  value={l.id}
                  checked={pick === l.id}
                  disabled={l.offered}
                  onChange={() => setPick(l.id)}
                />
                <span className="request-lot-title">{l.title}</span>
                <span className="request-lot-price">{formatPrice(l.price, l.currency, t)}</span>
                {l.offered ? (
                  <span className="badge success">{t('Предложен')}</span>
                ) : (
                  !l.withinBudget && (
                    <span className="badge warning">{t('Дороже, чем хочет покупатель')}</span>
                  )
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <div
          className={msg.ok ? 'alert success' : 'alert error'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {free.length > 0 && (list?.left ?? 0) > 0 && (
          <button
            type="button"
            className="btn"
            disabled={busy || !pick}
            onClick={() => void send()}
          >
            {t('Предложить')}
          </button>
        )}
        <Link href={newLot} className="btn secondary">
          {t('Выставить новый лот')}
        </Link>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          {t('Закрыть')}
        </button>
      </div>
    </div>
  );
}
