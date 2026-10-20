'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Paperclip, ShieldAlert } from 'lucide-react';
import { apiFetch, getToken, useSession } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { uploadViaPresignedUrl } from '@/lib/upload';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface Attach { url: string; mime: string }
interface DMsg {
  id: string;
  senderId: string | null;
  body: string;
  isInternal?: boolean;
  createdAt: string;
  attachments?: Attach[];
}
interface Dispute {
  id: string;
  orderId: string;
  reason: string;
  status: string;
  openedBy: string;
  arbiterId: string | null;
  resolutionNote: string | null;
}
interface Party { id: string; username: string | null }
interface DisputeView {
  dispute: Dispute;
  messages: DMsg[];
  isStaff?: boolean;
  canResolve?: boolean;
  order?: { id: string; publicNumber: string; amount: string; currency: string; title: string | null } | null;
  parties?: { buyer: Party | null; seller: Party | null; arbiter: Party | null };
}

const STATUS: Record<string, string> = {
  open: msg('ждёт арбитра'),
  in_review: msg('на рассмотрении у арбитра'),
  resolved_seller: msg('решён в пользу продавца'),
  resolved_buyer: msg('решён в пользу покупателя'),
  cancelled: msg('закрыт'),
};

export default function DisputePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const t = useT();
  const { ready, token, user: me } = useSession();
  const [view, setView] = useState<DisputeView | null>(null);
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView(await apiFetch<DisputeView>(`/disputes/${id}`));
  }, [id]);

  useEffect(() => {
    if (!getToken()) return;
    load().catch(() => setErr(t('Спор недоступен')));
  }, [load, t]);

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
    setDraft('');
    void run(
      () => apiFetch(`/disputes/${id}/messages`, { method: 'POST', body: JSON.stringify({ body, internal }) }),
      t('Не удалось отправить'),
    );
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await run(async () => {
      const att = await uploadViaPresignedUrl(`/disputes/${id}/uploads`, file);
      await apiFetch(`/disputes/${id}/messages`, { method: 'POST', body: JSON.stringify({ body: '', attachments: [att] }) });
    }, t('Файл отклонён (антивирус) или хранилище недоступно'));
  }

  function resolve(outcome: 'buyer' | 'seller') {
    const decision =
      outcome === 'buyer'
        ? t('Решение: вернуть деньги покупателю. Отменить его будет нельзя.')
        : t('Решение: отдать деньги продавцу. Отменить его будет нельзя.');
    const note = window.prompt(`${decision}\n${t('Комментарий для сторон:')}`, '');
    if (note === null) return;
    void run(
      () => apiFetch(`/disputes/${id}/resolve`, { method: 'POST', body: JSON.stringify({ outcome, ...(note.trim() ? { note: note.trim() } : {}) }) }),
      t('Не удалось принять решение'),
    );
  }

  if (!ready) return <div className="container" style={{ padding: 48 }} aria-busy="true" />;
  if (!token) return <div className="container" style={{ padding: 48 }}><p className="muted">{t('Войдите, чтобы открыть спор.')}</p></div>;
  if (!view) return <div className="container" style={{ padding: 48 }}>{err ?? ''}</div>;

  const { dispute, messages, order, parties } = view;
  const open = dispute.status === 'open' || dispute.status === 'in_review';
  // Подпись автора: арбитру важно видеть, кто есть кто, сторонам — где арбитр.
  const author = (m: DMsg) =>
    m.senderId === me?.id
      ? t('Вы')
      : m.senderId === parties?.buyer?.id
        ? `${t('Покупатель')}${parties?.buyer?.username ? ` · ${parties.buyer.username}` : ''}`
        : m.senderId === parties?.seller?.id
          ? `${t('Продавец')}${parties?.seller?.username ? ` · ${parties.seller.username}` : ''}`
          : t('Арбитр');

  return (
    <div className="container" style={{ paddingTop: 48, maxWidth: 720 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
        <h1 className="h2" style={{ fontSize: 22 }}>
          <ShieldAlert size={20} strokeWidth={1.75} style={{ verticalAlign: -3, marginRight: 6 }} />
          {t('Спор по заказу')}
        </h1>
        <span className={open ? 'badge warning' : 'badge'}>{STATUS[dispute.status] ? t(STATUS[dispute.status]!) : dispute.status}</span>
      </div>
      <Link href={`/orders/${dispute.orderId}`} className="faint" style={{ fontSize: 13 }}>← {t('К заказу')}</Link>

      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        {order && (
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{order.title ?? order.publicNumber}</span>
            <span className="price" style={{ fontSize: 16 }}>{formatPrice(order.amount, order.currency, t)}</span>
          </div>
        )}
        {parties && (
          <p className="faint" style={{ margin: '0 0 10px', fontSize: 13 }}>
            {t('Покупатель {buyer} · продавец {seller}', {
              buyer: parties.buyer?.username ?? '—',
              seller: parties.seller?.username ?? '—',
            })}
            {parties.arbiter ? ` · ${t('арбитр {name}', { name: parties.arbiter.username ?? '' })}` : ''}
          </p>
        )}
        <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>{t('Причина спора')}</div>
        <p className="muted" style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{dispute.reason}</p>
        {!open && dispute.resolutionNote && (
          <p style={{ margin: '12px 0 0', fontSize: 14 }}>
            <span className="faint">{t('Комментарий арбитра:')} </span>{dispute.resolutionNote}
          </p>
        )}
      </div>

      {view.canResolve && open && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <div className="label" style={{ marginBottom: 8 }}>{t('Решение арбитра')}</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {dispute.status === 'open' && (
              <button type="button" className="btn secondary" disabled={busy}
                onClick={() => void run(() => apiFetch(`/disputes/${id}/take`, { method: 'POST' }), t('Не удалось взять спор'))}>
                {t('Взять в работу')}
              </button>
            )}
            <button type="button" className="chip" disabled={busy} onClick={() => resolve('buyer')}>
              {t('Вернуть деньги покупателю')}
            </button>
            <button type="button" className="chip" disabled={busy} onClick={() => resolve('seller')}>
              {t('Отдать деньги продавцу')}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>{t('Деньги сразу уходят выбранной стороне, стороны получат уведомление.')}</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '20px 0 16px' }}>
        {messages.map((m) => (
          <div key={m.id} style={{ alignSelf: m.senderId === me?.id ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
            <div className="faint" style={{ fontSize: 12, margin: '0 4px 2px' }}>
              {author(m)}
              {m.isInternal ? ` · ${t('заметка, стороны её не видят')}` : ''}
            </div>
            <div className={`bubble ${m.senderId === me?.id ? 'mine' : 'their'}`}
              style={m.isInternal ? { background: 'var(--warning-bg)', color: 'var(--fg)' } : undefined}>
              {m.attachments?.length
                ? m.attachments.map((a, i) =>
                    a.mime.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={a.url} alt={t('доказательство')} style={{ maxWidth: 220, borderRadius: 8, display: 'block' }} />
                    ) : (
                      <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                        {t('Файл-доказательство')}
                      </a>
                    ),
                  )
                : m.body}
            </div>
          </div>
        ))}
        {!messages.length && <p className="muted" style={{ fontSize: 14 }}>{t('Сообщений пока нет. Опишите ситуацию и приложите доказательства.')}</p>}
      </div>

      {err && <p className="field-error" role="alert">{err}</p>}

      {open && (
        <form onSubmit={send}>
          <div className="row" style={{ gap: 8 }}>
            <label className="chip" style={{ cursor: 'pointer' }} aria-label={t('Прикрепить доказательство')}>
              <Paperclip size={16} strokeWidth={1.75} />
              <input type="file" onChange={onFile} disabled={busy} style={{ display: 'none' }} />
            </label>
            <input className="input" aria-label={t('Сообщение')} enterKeyHint="send" value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder={view.isStaff ? t('Сообщение сторонам…') : t('Сообщение арбитру и второй стороне…')} />
            <button className="btn" type="submit" disabled={busy}>{t('Отправить')}</button>
          </div>
          {view.isStaff && (
            <label className="row hint" style={{ gap: 8, marginTop: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              {t('Заметка для сотрудников — стороны её не увидят')}
            </label>
          )}
        </form>
      )}
    </div>
  );
}
