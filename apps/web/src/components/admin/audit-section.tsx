'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { Empty, when } from './shared';

interface Entry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: string | null;
  actorId: string | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

/** Понятные названия действий журнала; остальное показывается как есть. */
const ACTION: Record<string, string> = {
  'moderation.ban': 'бан',
  'moderation.block': 'блокировка',
  'moderation.unblock': 'снятие блокировки',
  'report.resolved': 'жалоба решена',
  'report.rejected': 'жалоба отклонена',
  'report.reviewing': 'жалоба взята в работу',
  'role.assign': 'выдана роль',
  'role.revoke': 'снята роль',
  'dispute.resolve.buyer': 'спор решён в пользу покупателя',
  'dispute.resolve.seller': 'спор решён в пользу продавца',
};

const ENTITY: Record<string, string> = { user: 'пользователь', listing: 'лот', report: 'жалоба', dispute: 'спор', payout: 'выплата' };

/** Журнал: кто из сотрудников что сделал — деньги, модерация, права. */
export function AuditSection() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  useEffect(() => {
    apiFetch<Entry[]>('/admin/audit?limit=150').then(setRows).catch(() => setRows([]));
  }, []);

  if (rows === null) return <div className="skeleton" style={{ height: 120 }} aria-busy="true" />;
  if (!rows.length) return <Empty>Журнал пуст.</Empty>;
  return (
    <section className="grid" style={{ gap: 6 }}>
      {rows.map((r) => {
        const reason = typeof r.after?.reason === 'string' ? r.after.reason : null;
        const role = typeof r.after?.roleKey === 'string' ? r.after.roleKey : null;
        return (
          <div key={r.id} className="row" style={{ gap: 12, fontSize: 14, padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span className="faint" style={{ width: 120, flex: 'none' }}>{when(r.createdAt)}</span>
            <span style={{ fontWeight: 600 }}>{r.actor ?? (r.actorId ? r.actorId.slice(0, 8) : 'система')}</span>
            <span>{ACTION[r.action] ?? r.action}{role ? ` «${role}»` : ''}</span>
            <span className="faint">{ENTITY[r.entityType] ?? r.entityType} {r.entityId.slice(0, 8)}</span>
            {reason && <span className="muted">— {reason}</span>}
          </div>
        );
      })}
    </section>
  );
}
