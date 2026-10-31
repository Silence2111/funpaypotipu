'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { SUPPORT_CATEGORY, TicketStatusBadge } from '@/components/support-ui';
import { useT } from '@/lib/i18n/client';

interface Ticket { id: string; subject: string; category: string; status: string; lastMessageAt: string }
interface OrderRow { id: string; publicNumber: string; title: string | null }

export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <Support />
    </Suspense>
  );
}

/** Обращения в поддержку: свои и новое — с разделом и заказом, как на FunPay. */
function Support() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const presetOrder = params.get('order') ?? '';
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [open, setOpen] = useState(!!presetOrder);
  const [category, setCategory] = useState(presetOrder ? 'order' : '');
  const [orderId, setOrderId] = useState(presetOrder);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTickets(await apiFetch<Ticket[]>('/support/tickets').catch(() => []));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/support');
      return;
    }
    void load();
    apiFetch<OrderRow[]>('/orders/mine?limit=30').then(setOrders).catch(() => {});
  }, [router, load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!category) return setErr(t('Выберите, о чём вопрос'));
    setBusy(true);
    setErr(null);
    try {
      const created = await apiFetch<{ id: string }>('/support/tickets', {
        method: 'POST',
        body: JSON.stringify({ category, subject: subject.trim(), body: body.trim(), ...(orderId ? { orderId } : {}) }),
      });
      router.push(`/cabinet/support/${created.id}`);
    } catch (e2) {
      setErr(apiErrorMessage(e2, t('Не удалось отправить обращение.')));
      setBusy(false);
    }
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
          <h1 className="h1" style={{ fontSize: 32 }}>{t('Поддержка')}</h1>
          {!open && <button type="button" className="btn" onClick={() => setOpen(true)}>{t('Новое обращение')}</button>}
        </div>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {open && (
        <form onSubmit={submit} className="card stack-form" style={{ padding: 24, gap: 16, maxWidth: 640 }} noValidate>
          <div className="field">
            <label className="label" htmlFor="sup-cat">{t('О чём вопрос')}</label>
            <select id="sup-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t('Выберите')}</option>
              {Object.entries(SUPPORT_CATEGORY).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </div>
          {(category === 'order' || category === 'payment' || orderId) && (
            <div className="field">
              <label className="label" htmlFor="sup-order">{t('Заказ — необязательно')}</label>
              <select id="sup-order" className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">{t('Без заказа')}</option>
                {/* Заказ из ссылки виден сразу, даже пока список не загрузился или он старше 30 последних */}
                {orderId && !orders.some((o) => o.id === orderId) && <option value={orderId}>{t('Заказ со страницы заказа')}</option>}
                {orders.map((o) => <option key={o.id} value={o.id}>{o.title ?? t('Заказ')} · {o.publicNumber}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="sup-subject">{t('Тема')}</label>
            <input id="sup-subject" className="input" maxLength={120} value={subject} placeholder={t('Коротко: что случилось')}
              onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="sup-body">{t('Подробности')}</label>
            <textarea id="sup-body" className="input" rows={5} maxLength={4000} value={body} style={{ resize: 'vertical' }}
              placeholder={t('Что делали, что ожидали, что получилось. Пароли и коды из СМС не присылайте.')}
              onChange={(e) => setBody(e.target.value)} />
            <p className="hint">{t('Спор по сделке быстрее решит арбитр — откройте его на странице заказа.')}</p>
          </div>
          {err && <div className="alert error" role="alert">{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" type="submit" disabled={busy}>{busy ? t('Отправляем…') : t('Отправить')}</button>
            <button className="btn ghost" type="button" onClick={() => setOpen(false)}>{t('Отмена')}</button>
          </div>
        </form>
      )}

      <section>
        {tickets === null ? (
          <div className="skeleton" style={{ height: 100 }} aria-busy="true" />
        ) : tickets.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{t('Обращений пока нет. Ответ обычно приходит в течение дня.')}</p>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {tickets.map((tk) => (
              <Link key={tk.id} href={`/cabinet/support/${tk.id}`} className="card link row"
                style={{ padding: 16, justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span>
                  <span style={{ fontWeight: 600, display: 'block' }}>{tk.subject}</span>
                  <span className="faint" style={{ fontSize: 13 }}>
                    {SUPPORT_CATEGORY[tk.category] ? t(SUPPORT_CATEGORY[tk.category]!) : tk.category} ·{' '}
                    {new Date(tk.lastMessageAt).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <TicketStatusBadge status={tk.status} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
