'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

interface Stats {
  firstReplySec: number | null;
  answered: number;
  avgRating: number | null;
  rated: number;
  waiting: number;
  escalated: number;
}
interface Template { id: string; title: string; body: string }

const duration = (sec: number | null) =>
  sec === null ? '—' : sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} мин` : `${Math.round((sec / 3600) * 10) / 10} ч`;

/**
 * Поддержка в консоли (часть 138): сводка за 30 дней — медиана первого
 * ответа, средняя оценка, сколько ждут и сколько просрочено (дольше 8 ч,
 * администратору уведомление) — и общие заготовки ответов.
 */
export function SupportExtras() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, tpl] = await Promise.all([apiFetch<Stats>('/support/stats/staff'), apiFetch<Template[]>('/support/templates')]);
    setStats(s);
    setTemplates(tpl);
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(apiErrorMessage(e, 'Не удалось загрузить сводку поддержки.')));
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch(editing ? `/support/templates/${editing.id}` : '/support/templates', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      setEditing(null);
      setTitle('');
      setBody('');
      await load();
    } catch (e2) {
      setErr(apiErrorMessage(e2, 'Не удалось сохранить заготовку.'));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {stats && (
        <div className="row faint" style={{ gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
          <span className="badge">первый ответ — {duration(stats.firstReplySec)} (медиана, 30 дней)</span>
          <span className="badge">оценка {stats.avgRating ? stats.avgRating.toFixed(1) : '—'} из 5 · {stats.rated}</span>
          <span className="badge">ждут ответа: {stats.waiting}</span>
          {stats.escalated > 0 && <span className="badge danger">дольше 8 ч: {stats.escalated}</span>}
        </div>
      )}
      <details className="card" style={{ padding: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Заготовки ответов · {templates.length}</summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {templates.map((x) => (
            <div key={x.id} className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14 }}><b>{x.title}</b> <span className="faint">{x.body.slice(0, 80)}{x.body.length > 80 ? '…' : ''}</span></span>
              <span className="row" style={{ gap: 6 }}>
                <button type="button" className="chip" onClick={() => { setEditing(x); setTitle(x.title); setBody(x.body); }}>Изменить</button>
                <button type="button" className="chip"
                  onClick={async () => {
                    if (!window.confirm(`Удалить заготовку «${x.title}»?`)) return;
                    await apiFetch(`/support/templates/${x.id}`, { method: 'DELETE' }).catch(() => null);
                    await load();
                  }}>
                  Удалить
                </button>
              </span>
            </div>
          ))}
          <form onSubmit={save} style={{ display: 'grid', gap: 8 }}>
            <input className="input" placeholder="Название, например «Где мой ключ»" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Название заготовки" />
            <textarea className="input" rows={3} maxLength={4000} placeholder="Текст ответа" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Текст заготовки" style={{ resize: 'vertical' }} />
            {err && <div className="alert error" role="alert">{err}</div>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" type="submit" disabled={title.trim().length < 2 || body.trim().length < 5}>{editing ? 'Сохранить' : 'Добавить заготовку'}</button>
              {editing && <button className="btn ghost" type="button" onClick={() => { setEditing(null); setTitle(''); setBody(''); }}>Отмена</button>}
            </div>
          </form>
        </div>
      </details>
    </div>
  );
}
