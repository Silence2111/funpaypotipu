'use client';

import Link from 'next/link';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Форма обращения к оператору. На сервере страницу /obrashchenie/ отдаёт Caddy из общей системы
 * юрдокументов, а эта — запасная, для стенда без неё: шлёт те же поля в тот же API
 * (modules/contact-requests), поэтому работает и тут. Тексты юридические — только по-русски.
 */
export function ContactRequestForm() {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const data = new URLSearchParams(new FormData(e.currentTarget) as unknown as Record<string, string>);
    try {
      const res = await fetch(`${API_URL}/api/obrashchenie/otpravit`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: data.toString(),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (body?.ok) setState({ ok: true, text: `Сообщение отправлено. Ответ придёт на ${data.get('svyaz')} в течение 10 рабочих дней.` });
      else setState({ ok: false, text: body?.error || 'Не получилось отправить. Попробуйте позже.' });
    } catch {
      setState({ ok: false, text: 'Не получилось отправить. Проверьте связь и попробуйте ещё раз.' });
    } finally {
      setBusy(false);
    }
  }

  if (state?.ok) return <p role="status">{state.text}</p>;
  return (
    <form className="stack-form" style={{ gap: 14 }} onSubmit={onSubmit}>
      <label className="field">
        <span className="label">Как к вам обращаться</span>
        <input className="input" name="imya" maxLength={120} autoComplete="name" />
      </label>
      <label className="field">
        <span className="label">Куда ответить: почта, телефон или ник в Telegram</span>
        <input className="input" name="svyaz" maxLength={200} required autoComplete="email" />
      </label>
      <label className="field">
        <span className="label">Сообщение</span>
        <textarea className="input" name="tekst" maxLength={4000} rows={6} required />
      </label>
      <div aria-hidden style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Сайт <input name="sait" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="row" style={{ gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
        <input type="checkbox" name="soglasie" value="da" required style={{ marginTop: 3 }} />
        <span>
          Согласен на обработку имени, контакта и текста сообщения, чтобы получить ответ (
          <Link href="/obrashchenie/soglasie">текст согласия</Link>).
        </span>
      </label>
      {state && !state.ok && (
        <p className="field-error" role="alert" style={{ margin: 0 }}>
          {state.text}
        </p>
      )}
      <div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Отправляем…' : 'Отправить'}
        </button>
      </div>
    </form>
  );
}
