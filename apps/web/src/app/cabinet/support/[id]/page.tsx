'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch, useSession } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { SUPPORT_CATEGORY, TicketStatusBadge } from '@/components/support-ui';

interface View {
  ticket: { id: string; subject: string; category: string; status: string; createdAt: string };
  isStaff: boolean;
  owner: { id: string; username: string | null };
  order: { id: string; publicNumber: string; status: string } | null;
  messages: Array<{ id: string; body: string; fromStaff: boolean; mine: boolean; createdAt: string }>;
}

/** Переписка по обращению — у автора и у сотрудника поддержки одна страница. */
export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, token } = useSession();
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView(await apiFetch<View>(`/support/tickets/${id}`));
  }, [id]);

  useEffect(() => {
    if (!token) return;
    load().catch(() => setErr('Обращение не найдено'));
  }, [load, token]);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    void run(async () => {
      await apiFetch(`/support/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      setDraft('');
    }, 'Сообщение не отправлено.');
  }

  if (!ready) return <div className="container" style={{ padding: 48 }} aria-busy="true" />;
  if (!token) return <div className="container" style={{ padding: 48 }}><p className="muted">Войдите, чтобы открыть обращение.</p></div>;
  if (!view) return <div className="container" style={{ padding: 48 }}>{err ?? <div className="skeleton" style={{ height: 120 }} />}</div>;

  const { ticket, isStaff, owner, order, messages } = view;
  const staffView = isStaff && !messages.some((m) => m.mine && !m.fromStaff);

  return (
    <div className="container" style={{ paddingTop: 40, maxWidth: 720 }}>
      <Link href={staffView ? '/admin?tab=support' : '/cabinet/support'} className="faint" style={{ fontSize: 13 }}>
        ← {staffView ? 'Очередь поддержки' : 'Все обращения'}
      </Link>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        <h1 className="h2" style={{ lineHeight: 1.25 }}>{ticket.subject}</h1>
        <TicketStatusBadge status={ticket.status} staffView={staffView} />
      </div>
      <p className="faint" style={{ fontSize: 13, margin: '6px 0 0' }}>
        {order ? (
          // «Заказ · заказ GM-…» читалось бы дважды: раздел «Заказ» и есть этот заказ.
          <>
            {ticket.category === 'order' ? 'Заказ' : `${SUPPORT_CATEGORY[ticket.category] ?? ticket.category} · заказ`}{' '}
            <Link href={`/orders/${order.id}`}>{order.publicNumber}</Link>
          </>
        ) : (
          SUPPORT_CATEGORY[ticket.category] ?? ticket.category
        )}
        {staffView ? ` · от ${owner.username ?? 'пользователя'}` : ''}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '24px 0 16px' }}>
        {messages.map((m) => (
          <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
            <div className="faint" style={{ fontSize: 12, margin: '0 4px 2px', textAlign: m.mine ? 'right' : 'left' }}>
              {m.mine ? 'Вы' : m.fromStaff ? 'Поддержка' : owner.username ?? 'Пользователь'} ·{' '}
              {new Date(m.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className={`bubble ${m.mine ? 'mine' : 'their'}`} style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
          </div>
        ))}
      </div>

      {err && <p className="field-error" role="alert">{err}</p>}

      <form onSubmit={send} className="stack-form" style={{ gap: 10 }}>
        <textarea className="input" rows={3} maxLength={4000} value={draft} aria-label="Сообщение"
          placeholder={ticket.status === 'closed' ? 'Обращение закрыто — сообщение откроет его снова' : 'Сообщение…'}
          onChange={(e) => setDraft(e.target.value)} style={{ resize: 'vertical' }} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" type="submit" disabled={busy || !draft.trim()}>Отправить</button>
          {ticket.status !== 'closed' && (
            <button className="btn ghost" type="button" disabled={busy}
              onClick={() => void run(() => apiFetch(`/support/tickets/${id}/close`, { method: 'POST' }), 'Не удалось закрыть обращение.')}>
              {staffView ? 'Закрыть обращение' : 'Вопрос решён'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
