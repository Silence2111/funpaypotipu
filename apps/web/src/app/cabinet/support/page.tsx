'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { SUPPORT_CATEGORY, TicketStatusBadge } from '@/components/support-ui';

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
    apiFetch<OrderRow[]>('/orders/mine').then((o) => setOrders(o.slice(0, 30))).catch(() => {});
  }, [router, load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!category) return setErr('Выберите, о чём вопрос');
    setBusy(true);
    setErr(null);
    try {
      const t = await apiFetch<{ id: string }>('/support/tickets', {
        method: 'POST',
        body: JSON.stringify({ category, subject: subject.trim(), body: body.trim(), ...(orderId ? { orderId } : {}) }),
      });
      router.push(`/cabinet/support/${t.id}`);
    } catch (e2) {
      setErr(apiErrorMessage(e2, 'Не удалось отправить обращение.'));
      setBusy(false);
    }
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
          <h1 className="h1" style={{ fontSize: 32 }}>Поддержка</h1>
          {!open && <button type="button" className="btn" onClick={() => setOpen(true)}>Новое обращение</button>}
        </div>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {open && (
        <form onSubmit={submit} className="card stack-form" style={{ padding: 24, gap: 16, maxWidth: 640 }} noValidate>
          <div className="field">
            <label className="label" htmlFor="sup-cat">О чём вопрос</label>
            <select id="sup-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Выберите</option>
              {Object.entries(SUPPORT_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {(category === 'order' || category === 'payment' || orderId) && (
            <div className="field">
              <label className="label" htmlFor="sup-order">Заказ — необязательно</label>
              <select id="sup-order" className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">Без заказа</option>
                {/* Заказ из ссылки виден сразу, даже пока список не загрузился или он старше 30 последних */}
                {orderId && !orders.some((o) => o.id === orderId) && <option value={orderId}>Заказ со страницы заказа</option>}
                {orders.map((o) => <option key={o.id} value={o.id}>{o.title ?? 'Заказ'} · {o.publicNumber}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="sup-subject">Тема</label>
            <input id="sup-subject" className="input" maxLength={120} value={subject} placeholder="Коротко: что случилось"
              onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="sup-body">Подробности</label>
            <textarea id="sup-body" className="input" rows={5} maxLength={4000} value={body} style={{ resize: 'vertical' }}
              placeholder="Что делали, что ожидали, что получилось. Пароли и коды из СМС не присылайте."
              onChange={(e) => setBody(e.target.value)} />
            <p className="hint">Спор по сделке быстрее решит арбитр — откройте его на странице заказа.</p>
          </div>
          {err && <div className="alert error" role="alert">{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить'}</button>
            <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Отмена</button>
          </div>
        </form>
      )}

      <section>
        {tickets === null ? (
          <div className="skeleton" style={{ height: 100 }} aria-busy="true" />
        ) : tickets.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Обращений пока нет. Ответ обычно приходит в течение дня.</p>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {tickets.map((t) => (
              <Link key={t.id} href={`/cabinet/support/${t.id}`} className="card link row"
                style={{ padding: 16, justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span>
                  <span style={{ fontWeight: 600, display: 'block' }}>{t.subject}</span>
                  <span className="faint" style={{ fontSize: 13 }}>
                    {SUPPORT_CATEGORY[t.category] ?? t.category} · {new Date(t.lastMessageAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <TicketStatusBadge status={t.status} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
