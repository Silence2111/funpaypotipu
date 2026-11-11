'use client';

import { useEffect, useState } from 'react';
import { LINK_REASON_LABEL, STRONG_LINKS, type LinkReason } from '@gamemarket/shared/antifraud';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { withQuery } from '@/lib/url';
import { StatusBadge, USER_STATUS, when } from './shared';

interface Signal {
  id: string;
  type: string;
  score: number;
  payload: { what?: string } | null;
  createdAt: string;
}
interface Link {
  userId: string;
  username: string | null;
  status: string;
  reasons: LinkReason[];
}
interface Risk {
  score: number;
  signals: number;
  recent: Signal[];
  links: Link[];
}

/** Что произошло — словами: тип сигнала и уточнение антифрода (часть 128). */
const WHAT: Record<string, string> = {
  payments_per_hour: 'частые попытки оплаты',
  newbie_pay_day: 'новичок упёрся в лимит оплат за сутки',
  newbie_lots_day: 'новичок упёрся в лимит лотов за сутки',
  linked_deal: 'покупка у связанного аккаунта — отказ',
  banned_requisites: 'вывод на реквизиты забаненного — отказ',
  banned_device: 'вход с браузера забаненного',
};
const TYPE: Record<string, string> = {
  multiaccount: 'несколько аккаунтов',
  velocity: 'частота',
  chargeback: 'возврат платежа банком',
  contact_leak: 'контакты в чате',
  payment_mismatch: 'расхождение оплаты',
  other: 'другое',
};

/**
 * Риск и связи пользователя в консоли (часть 128): балл за 30 дней,
 * последние сигналы и аккаунты, связанные общим браузером, реквизитами
 * вывода (сильная связь — сделки между ними запрещены) или адресом IP
 * (слабая: мобильные сети и общий Wi‑Fi).
 */
export function UserRisk({ userId }: { userId: string }) {
  const [data, setData] = useState<Risk | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Risk>(`/trust/users/${userId}`)
      .then(setData)
      .catch((e) => setErr(apiErrorMessage(e, 'Не удалось загрузить риск и связи.')));
  }, [userId]);

  if (err) return <div className="alert error" role="alert" style={{ marginTop: 10 }}>{err}</div>;
  if (!data) return <div className="skeleton" style={{ height: 60, marginTop: 10 }} aria-busy="true" />;

  return (
    <div className="card flat" style={{ marginTop: 10, padding: 12, display: 'grid', gap: 10, background: 'var(--page)' }}>
      <div style={{ fontSize: 14 }}>
        <strong>Риск за 30 дней: {data.score}</strong>
        <span className="faint"> · сигналов {data.signals}</span>
      </div>
      {data.recent.length > 0 && (
        <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
          {data.recent.slice(0, 8).map((s) => (
            <li key={s.id}>
              {when(s.createdAt)} · {(s.payload?.what && WHAT[s.payload.what]) ?? TYPE[s.type] ?? s.type} · +{s.score}
            </li>
          ))}
        </ul>
      )}
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Связанные аккаунты</div>
        {data.links.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>Нет: ни общего браузера, ни реквизитов, ни адреса.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {data.links.map((l) => (
              <li key={l.userId} className="row" style={{ gap: 8, flexWrap: 'wrap', fontSize: 14 }}>
                <a href={withQuery('/admin', { tab: 'users', q: l.userId })} style={{ fontWeight: 600 }}>
                  {l.username ?? l.userId.slice(0, 8)}
                </a>
                <StatusBadge status={l.status} labels={USER_STATUS} />
                <span className={l.reasons.some((r) => STRONG_LINKS.includes(r)) ? undefined : 'faint'}>
                  {l.reasons.map((r) => LINK_REASON_LABEL[r]).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
