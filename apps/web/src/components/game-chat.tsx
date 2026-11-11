'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { GAME_CHAT_MAX_LEN } from '@gamemarket/shared/game-chat';
import { apiFetch, useSession } from '@/lib/session';
import { apiErrorMessage, errorBody } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { ReportButton } from './report-button';

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; username: string | null; ratingAvg: number; ratingCount: number; salesCount: number };
}
interface ChatPage {
  items: ChatMessage[];
  more: boolean;
}

/** Как часто подтягивать новые сообщения, пока вкладка открыта. */
const POLL_MS = 15_000;

/**
 * Общий чат игры (часть 133) — под предложениями раздела, как у FunPay:
 * «скупаю», «кто продаст». Читать — всем, писать — после входа. Контакты и
 * ссылки скрываются, сделки — через лоты; у новичка — реже; на сообщение
 * можно пожаловаться, своё — удалить.
 */
export function GameChat({ slug, title }: { slug: string; title: string }) {
  const t = useT();
  const path = usePathname();
  const { ready, user } = useSession();
  const [items, setItems] = useState<ChatMessage[] | null>(null);
  const [more, setMore] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    const page = await apiFetch<ChatPage>(`/game-chat/${encodeURIComponent(slug)}`);
    setItems((prev) => {
      // Подгруженные раньше старые сообщения не теряем.
      if (!prev?.length) return page.items;
      const first = page.items[0];
      const older = first ? prev.filter((m) => new Date(m.createdAt) < new Date(first.createdAt)) : [];
      return [...older, ...page.items];
    });
    // «Показать раньше» — по первой загрузке; дальше его ведёт сама кнопка.
    if (firstLoad.current) {
      firstLoad.current = false;
      setMore(page.more);
    }
  }, [slug]);

  useEffect(() => {
    load().catch(() => setItems([]));
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Новые сообщения — вниз, если человек и так внизу, а не читает старое.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  async function earlier() {
    if (!items?.length) return;
    const page = await apiFetch<ChatPage>(`/game-chat/${encodeURIComponent(slug)}?before=${items[0]!.id}`);
    stick.current = false;
    setItems((prev) => [...page.items, ...(prev ?? [])]);
    setMore(page.more);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (body.length < 2) return;
    setBusy(true);
    setMsg(null);
    try {
      const sent = await apiFetch<ChatMessage & { masked?: boolean }>(`/game-chat/${encodeURIComponent(slug)}`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      stick.current = true;
      setItems((prev) => [...(prev ?? []).filter((m) => m.id !== sent.id), sent]);
      setText('');
      if (sent.masked) setMsg({ ok: true, text: t('Контакты и ссылки скрыты: договариваться и платить — только через лоты.') });
    } catch (err) {
      const b = errorBody(err) as { error?: string; until?: string; reason?: string | null } | null;
      if (b?.error === 'chat_muted' && b.until) {
        const until = new Date(b.until).toLocaleString(t.locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
        setMsg({
          ok: false,
          text: t('Писать в чаты игр нельзя до {until}. Причина: {reason}', { until, reason: b.reason ?? t('нарушение правил чата') }),
        });
      } else {
        setMsg({ ok: false, text: apiErrorMessage(err, t('Не удалось отправить сообщение.')) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('Удалить сообщение?'))) return;
    try {
      await apiFetch(`/game-chat/messages/${id}`, { method: 'DELETE' });
      setItems((prev) => prev?.filter((m) => m.id !== id) ?? null);
    } catch (err) {
      setMsg({ ok: false, text: apiErrorMessage(err, t('Не удалось удалить сообщение.')) });
    }
  }

  const time = (iso: string) => {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return d.toLocaleString(t.locale, today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <section className="card" style={{ marginTop: 32, padding: 20 }} aria-labelledby="game-chat-title">
      <h2 className="h2 row" id="game-chat-title" style={{ fontSize: 20, gap: 8, margin: 0 }}>
        <MessagesSquare size={20} strokeWidth={1.75} aria-hidden /> {t('Чат игры {game}', { game: t.d(title) })}
      </h2>
      <p className="hint" style={{ margin: '4px 0 12px' }}>
        {t('Общий чат: ищут и предлагают. Контакты и ссылки скрываются — сделки только через лоты, иначе защиты сделки нет.')}
      </p>

      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 10, paddingRight: 4 }}
        aria-live="polite"
      >
        {more && (
          <button type="button" className="chip" style={{ justifySelf: 'center' }} onClick={() => void earlier()}>
            {t('Показать раньше')}
          </button>
        )}
        {items === null ? (
          <div className="skeleton" style={{ height: 80 }} aria-busy="true" />
        ) : items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{t('Пока тихо. Напишите первым: что ищете или что предлагаете.')}</p>
        ) : (
          items.map((m) => (
            <article key={m.id} style={{ display: 'grid', gap: 2 }}>
              <div className="row" style={{ gap: 8, fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
                <Link href={`/prodavec/${m.user.id}`} style={{ fontWeight: 600 }}>
                  {m.user.username ?? t('Пользователь')}
                </Link>
                {m.user.ratingCount > 0 && <span className="faint">★ {m.user.ratingAvg.toFixed(1)}</span>}
                <time className="faint" dateTime={m.createdAt}>{time(m.createdAt)}</time>
                {ready && user && (
                  <span className="chat-msg-actions">
                    {user.id === m.user.id ? (
                      <button type="button" className="inline-link faint"
                        style={{ background: 'none', border: 0, padding: 4, font: 'inherit', cursor: 'pointer' }}
                        onClick={() => void remove(m.id)}>
                        {t('Удалить')}
                      </button>
                    ) : (
                      <ReportButton targetType="game_chat" targetId={m.id} ownerId={m.user.id} inline compact />
                    )}
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 15, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</p>
            </article>
          ))
        )}
      </div>

      {msg && (
        <div className={msg.ok ? 'alert' : 'alert error'} role={msg.ok ? 'status' : 'alert'} style={{ marginTop: 12 }}>
          {msg.text}
        </div>
      )}

      {ready && user ? (
        <form onSubmit={send} className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 220, margin: 0 }}>
            <label className="label" htmlFor="game-chat-input">{t('Сообщение')}</label>
            <input id="game-chat-input" className="input" maxLength={GAME_CHAT_MAX_LEN} value={text}
              placeholder={t('Например: скупаю скины, кто продаст голду')}
              onChange={(e) => setText(e.target.value)} />
          </div>
          <button className="btn" type="submit" disabled={busy || text.trim().length < 2}>{t('Отправить')}</button>
        </form>
      ) : (
        ready && (
          <p className="hint" style={{ margin: '12px 0 0' }}>
            <Link href={`/login?next=${encodeURIComponent(path)}`} style={{ color: 'var(--accent)' }}>{t('Войдите')}</Link>
            {', '}{t('чтобы писать в чат.')}
          </p>
        )
      )}
    </section>
  );
}
