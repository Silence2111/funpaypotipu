'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { SUPPORT_CATEGORY } from '@/components/support-ui';
import { Empty, when } from './shared';

interface Row {
  id: string;
  subject: string;
  category: string;
  status: string;
  lastMessageAt: string;
  messages: number;
  user: string | null;
  assignee: string | null;
}

const FILTERS = [
  { key: 'open', label: 'Ждут ответа' },
  { key: 'answered', label: 'Ждём пользователя' },
  { key: 'closed', label: 'Закрытые' },
];

/** Очередь поддержки: ждущие ответа — старые сверху, чтобы никто не ждал дольше всех. */
export function SupportSection() {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    setRows(null);
    apiFetch<Row[]>(`/support/queue?status=${status}`).then(setRows).catch(() => setRows([]));
  }, [status]);

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={status === f.key} onClick={() => setStatus(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {rows === null ? (
        <div className="skeleton" style={{ height: 100 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        <Empty>Обращений нет.</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((t) => (
            <Link key={t.id} href={`/cabinet/support/${t.id}`} className="card link" style={{ padding: 16, display: 'block' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{t.subject}</span>
                <span className="faint" style={{ fontSize: 13 }}>{when(t.lastMessageAt)}</span>
              </div>
              <div className="faint" style={{ fontSize: 13, marginTop: 4 }}>
                {SUPPORT_CATEGORY[t.category] ?? t.category} · {t.user ?? 'пользователь'} · сообщений: {t.messages}
                {t.assignee ? ` · ведёт ${t.assignee}` : ''}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
