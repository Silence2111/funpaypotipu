'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, MessagesSquare, SendHorizontal, X } from 'lucide-react';
import { apiFetch, getUser, type SessionUser } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { ChatThread } from './chat-thread';

/** Начатый диалог с продавцом — ответ `GET /conversations/for-listing/:id`. */
interface Started {
  id: string | null;
  unread: number;
}

/**
 * Чат с продавцом прямо на странице лота, как у FunPay: вопрос до покупки —
 * без перехода в «Сообщения». Диалог создаётся с первым сообщением, а не
 * с нажатия кнопки: у продавца не копятся пустые переписки. Если переписка
 * уже есть, кнопка говорит об этом и показывает новые ответы.
 *
 * `children` — остальные кнопки карточки продавца, в одном ряду с чатом.
 */
export function LotChat({
  listingId,
  sellerId,
  manual,
  children,
}: {
  listingId: string;
  sellerId: string;
  /** Товар выдаёт продавец — уместен вопрос о сроках. */
  manual: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [me, setMe] = useState<SessionUser | null>(null);
  const [started, setStarted] = useState<Started | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setMe(getUser());
    sync();
    window.addEventListener('gm-auth', sync);
    return () => window.removeEventListener('gm-auth', sync);
  }, []);

  const own = me?.id === sellerId;

  useEffect(() => {
    if (!me || own) return;
    apiFetch<Started>(`/conversations/for-listing/${listingId}`)
      .then(setStarted)
      .catch(() => setStarted({ id: null, unread: 0 }));
  }, [me, own, listingId]);

  function toggle() {
    if (!me) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    // Открытый чат читается сразу — счётчик на кнопке гаснет.
    if (!open && started?.unread) setStarted({ ...started, unread: 0 });
    setOpen(!open);
  }

  async function start(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch<{ id: string }>(`/conversations/for-listing/${listingId}`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      });
      setDraft('');
      setStarted({ id: res.id, unread: 0 });
    } catch (er) {
      setErr(apiErrorMessage(er, 'Сообщение не отправлено. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  }

  const quick = manual ? ['Ещё продаёте?', 'Когда сможете выдать?'] : ['Ещё продаёте?'];
  const convId = started?.id ?? null;

  return (
    <>
      <div className="row seller-actions">
        {!own && (
          <button type="button" className="chip" aria-expanded={open} aria-controls="lot-chat" onClick={toggle}>
            <MessagesSquare size={16} strokeWidth={1.75} aria-hidden />
            {convId ? 'Чат с продавцом' : 'Написать продавцу'}
            {!open && started?.unread ? (
              <span className="conv-unread" aria-label={`Новых ответов: ${started.unread}`}>
                {started.unread > 99 ? '99+' : started.unread}
              </span>
            ) : null}
          </button>
        )}
        {children}
      </div>

      {open && me && (
        <div className="lot-chat" id="lot-chat">
          <div className="lot-chat-head">
            <span className="lot-chat-title">{convId ? 'Чат с продавцом' : 'Вопрос продавцу'}</span>
            {convId && (
              <Link href={`/chat/${convId}`} className="lot-chat-link">
                В сообщениях <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
              </Link>
            )}
            <button type="button" className="lot-chat-close" aria-label="Свернуть чат" onClick={() => setOpen(false)}>
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>

          {convId ? (
            <ChatThread conversationId={convId} meId={me.id} embedded aboutListingId={listingId} />
          ) : (
            <form className="lot-chat-start" onSubmit={start}>
              <p className="hint" style={{ margin: 0 }}>
                Спросите до покупки — ответ придёт сюда и в «Сообщения».
              </p>
              <div className="lot-chat-quick">
                {quick.map((q) => (
                  <button key={q} type="button" className="chip" onClick={() => setDraft(q)}>
                    {q}
                  </button>
                ))}
              </div>
              {err && (
                <p className="field-error" role="alert" style={{ margin: '10px 0 0' }}>
                  {err}
                </p>
              )}
              <div className="thread-compose">
                <textarea
                  className="input"
                  rows={1}
                  enterKeyHint="send"
                  value={draft}
                  maxLength={4000}
                  placeholder="Сообщение"
                  aria-label="Сообщение продавцу"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void start();
                    }
                  }}
                />
                <button className="btn" type="submit" aria-label="Отправить" disabled={!draft.trim() || busy}>
                  <SendHorizontal size={18} strokeWidth={1.75} />
                </button>
              </div>
              <p className="thread-note">Телефоны, ники в мессенджерах и ссылки скрываются автоматически.</p>
            </form>
          )}
        </div>
      )}
    </>
  );
}
