'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Paperclip, ShieldAlert } from 'lucide-react';
import { apiFetch, getToken, getUser } from '@/lib/session';

interface Attach { url: string; mime: string }
interface DMsg { id: string; senderId: string | null; body: string; createdAt: string; attachments?: Attach[] }
interface Dispute { id: string; orderId: string; reason: string; status: string; openedBy: string }

const STATUS_RU: Record<string, string> = {
  open: 'открыт',
  in_review: 'на рассмотрении арбитром',
  resolved: 'решён',
  resolved_seller: 'решён в пользу продавца',
  resolved_buyer: 'решён в пользу покупателя',
  rejected: 'отклонён',
};

export default function DisputePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const me = getUser();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [messages, setMessages] = useState<DMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<{ dispute: Dispute; messages: DMsg[] }>(`/disputes/${id}`);
    setDispute(r.dispute);
    setMessages(r.messages);
  }, [id]);

  useEffect(() => {
    if (!getToken()) return;
    load().catch(() => setErr('Спор недоступен'));
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      await apiFetch(`/disputes/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      await load();
    } catch {
      setErr('Не удалось отправить');
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const mime = file.type || 'application/octet-stream';
      const up = await apiFetch<{ key: string; uploadUrl: string }>(`/disputes/${id}/uploads`, {
        method: 'POST',
        body: JSON.stringify({ mime }),
      });
      await fetch(up.uploadUrl, { method: 'PUT', body: file });
      await apiFetch(`/disputes/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: '', attachments: [{ key: up.key, mime, size: file.size }] }),
      });
      await load();
    } catch {
      setErr('Файл отклонён (антивирус) или хранилище недоступно');
    } finally {
      setBusy(false);
    }
  }

  if (!getToken()) return <div className="container" style={{ padding: 48 }}><p className="muted">Войдите, чтобы открыть спор.</p></div>;
  if (!dispute) return <div className="container" style={{ padding: 48 }}>{err ?? ''}</div>;

  return (
    <div className="container" style={{ paddingTop: 48, maxWidth: 680 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 className="h2" style={{ fontSize: 22 }}>
          <ShieldAlert size={20} strokeWidth={1.75} style={{ verticalAlign: -3, marginRight: 6 }} />
          Спор по заказу
        </h1>
        <span className="badge">{STATUS_RU[dispute.status] ?? dispute.status}</span>
      </div>
      <Link href={`/orders/${dispute.orderId}`} className="faint" style={{ fontSize: 13 }}>← К заказу</Link>

      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>Причина спора</div>
        <p className="muted" style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{dispute.reason}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '20px 0 16px' }}>
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.senderId === me?.id ? 'mine' : 'their'}`}>
            {m.attachments?.length
              ? m.attachments.map((a, i) =>
                  a.mime.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={a.url} alt="доказательство" style={{ maxWidth: 220, borderRadius: 8, display: 'block' }} />
                  ) : (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                      Файл-доказательство
                    </a>
                  ),
                )
              : m.body}
          </div>
        ))}
        {!messages.length && <p className="muted" style={{ fontSize: 14 }}>Сообщений пока нет. Опишите ситуацию и приложите доказательства.</p>}
      </div>

      {err && <p style={{ color: '#d33', fontSize: 13 }}>{err}</p>}

      {(dispute.status === 'open' || dispute.status === 'in_review') && (
        <form onSubmit={send} className="row" style={{ gap: 8 }}>
          <label className="chip" style={{ cursor: 'pointer' }} aria-label="Прикрепить доказательство">
            <Paperclip size={16} strokeWidth={1.75} />
            <input type="file" onChange={onFile} disabled={busy} style={{ display: 'none' }} />
          </label>
          <input className="input" placeholder="Сообщение арбитру и второй стороне…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn" type="submit">Отправить</button>
        </form>
      )}
    </div>
  );
}
