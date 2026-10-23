'use client';

import { useCallback, useEffect, useState } from 'react';
import { NOTIFY_LABELS } from '@gamemarket/shared';
import { apiFetch } from '@/lib/session';
import { ORDER_STATUS_LABELS } from '@/lib/chat';
import { apiErrorMessage } from '@/lib/errors';
import { Empty, when } from './shared';

interface Row {
  id: string;
  createdAt: string;
  status: string;
  reason: string;
  email: string | null;
  username: string | null;
  orders: { given: number; found: number };
  objected: boolean;
  decideAfter: string;
}

interface Detail {
  id: string;
  status: string;
  reason: string;
  details: string;
  createdAt: string;
  decideAfter: string;
  requester: { device: string; ip: string | null };
  objected: { at: string; from: string | null } | null;
  decidedAt: string | null;
  note: string | null;
  account: {
    username: string | null;
    email: string | null;
    emailVerified: boolean;
    createdAt: string;
    hasPassword: boolean;
    twoFactorSince: string | null;
    telegram: boolean;
    social: Array<{ provider: string; createdAt: string }>;
  };
  orders: Array<{ number: string; found: boolean; role?: string; status?: string; amount?: string; createdAt?: string }>;
  history: Array<{ type: string; at: string; device: string | null; ip: string | null }>;
}

const REASON: Record<string, string> = {
  two_factor: 'вход с кодом включил не владелец',
  password: 'пароль сменил не владелец',
  other: 'другое',
};

const FILTERS = [
  { key: 'pending', label: 'Ждут решения' },
  { key: 'restored', label: 'Восстановлены' },
  { key: 'rejected', label: 'Отклонены' },
];

const rub = (minor: string) => `${(Number(minor) / 100).toLocaleString('ru-RU')} ₽`;

/**
 * «Не могу войти»: заявки на восстановление доступа. Решение — не раньше
 * чем через 3 дня после заявки; перед ним видно, какие заказы из заявки у
 * аккаунта, возражал ли владелец из аккаунта и что с аккаунтом происходило.
 */
export function RecoverySection() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await apiFetch<Row[]>(`/recovery/queue?status=${status}`).catch(() => []));
  }, [status]);
  useEffect(() => {
    setRows(null);
    setOpen(null);
    void load();
  }, [load]);

  async function show(id: string) {
    setErr(null);
    setNote('');
    if (open?.id === id) return setOpen(null);
    try {
      setOpen(await apiFetch<Detail>(`/recovery/${id}`));
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось открыть заявку.'));
    }
  }

  async function decide(id: string, action: 'restore' | 'reject') {
    setErr(null);
    if (action === 'reject' && note.trim().length < 5) {
      setErr('Напишите причину отказа — она уйдёт на почту аккаунта.');
      return;
    }
    try {
      await apiFetch(`/recovery/${id}/${action}`, {
        method: 'POST',
        body: action === 'reject' ? JSON.stringify({ note }) : undefined,
      });
      setOpen(null);
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось сохранить решение.'));
    }
  }

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={status === f.key} onClick={() => setStatus(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 100 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        <Empty>Заявок нет.</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((r) => (
            <div key={r.id} className="card" style={{ padding: 16 }}>
              <button type="button" className="recovery-row" aria-expanded={open?.id === r.id} onClick={() => void show(r.id)}>
                <span style={{ fontWeight: 600 }}>
                  {r.username ? `@${r.username}` : 'без ника'} <span className="faint" style={{ fontWeight: 400 }}>{r.email}</span>
                </span>
                <span className="faint" style={{ fontSize: 13 }}>
                  {REASON[r.reason] ?? r.reason} · заказов совпало: {r.orders.found} из {r.orders.given} · {when(r.createdAt)}
                  {r.status === 'pending' ? ` · решение после ${when(r.decideAfter)}` : ''}
                </span>
                {r.objected && <span className="badge warning">владелец из аккаунта возражает</span>}
              </button>
              {open?.id === r.id && <RecoveryDetail d={open} note={note} setNote={setNote} decide={decide} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RecoveryDetail({
  d,
  note,
  setNote,
  decide,
}: {
  d: Detail;
  note: string;
  setNote: (v: string) => void;
  decide: (id: string, action: 'restore' | 'reject') => Promise<void>;
}) {
  const ready = Date.now() >= new Date(d.decideAfter).getTime();
  const a = d.account;
  return (
    <div className="recovery-detail">
      <div>
        <h3 className="recovery-h">Заявка</h3>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.details}</p>
        <p className="faint" style={{ margin: '6px 0 0', fontSize: 13 }}>
          {REASON[d.reason] ?? d.reason} · {d.requester.device}
          {d.requester.ip ? ` · IP ${d.requester.ip}` : ''} · {when(d.createdAt)}
        </p>
        {d.objected && (
          <p className="badge warning" style={{ marginTop: 8 }}>
            Из аккаунта отметили «Заявку подал не я»: {when(d.objected.at)}
            {d.objected.from ? `, ${d.objected.from}` : ''}
          </p>
        )}
      </div>

      <div>
        <h3 className="recovery-h">Аккаунт</h3>
        <p className="faint" style={{ margin: 0, fontSize: 13 }}>
          {a.username ? `@${a.username}` : 'без ника'} · {a.email ?? 'без почты'}
          {a.emailVerified ? ' (подтверждена)' : ' (не подтверждена)'} · на площадке с {when(a.createdAt)}
        </p>
        <p className="faint" style={{ margin: '4px 0 0', fontSize: 13 }}>
          {a.hasPassword ? 'пароль задан' : 'пароля нет'} ·{' '}
          {a.twoFactorSince ? `вход с кодом с ${when(a.twoFactorSince)}` : 'вход с кодом выключен'}
          {a.telegram ? ' · Telegram подключён' : ''}
          {a.social.length > 0 &&
            ` · вход через ${a.social.map((s) => `${s.provider} (с ${when(s.createdAt)})`).join(', ')}`}
        </p>
      </div>

      <div>
        <h3 className="recovery-h">Заказы из заявки</h3>
        {d.orders.length === 0 ? (
          <Empty>Номеров не указали.</Empty>
        ) : (
          <ul className="recovery-list">
            {d.orders.map((o) => (
              <li key={o.number}>
                <span className="recovery-mono">{o.number}</span>{' '}
                {o.found ? (
                  <span>
                    ✓ {o.role === 'buyer' ? 'покупка' : 'продажа'} этого аккаунта ·{' '}
                    {ORDER_STATUS_LABELS[o.status ?? ''] ?? o.status} ·{' '}
                    <span className="recovery-mono">{rub(o.amount ?? '0')}</span> · {when(o.createdAt ?? d.createdAt)}
                  </span>
                ) : (
                  <span className="faint">✕ не у этого аккаунта</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="faint" style={{ margin: '6px 0 0', fontSize: 12 }}>
          Номера заказов приходят и в письмах — тот, кто читает почту аккаунта, их тоже знает.
        </p>
      </div>

      <div>
        <h3 className="recovery-h">Безопасность аккаунта</h3>
        {d.history.length === 0 ? (
          <Empty>Событий нет.</Empty>
        ) : (
          <ul className="recovery-list">
            {d.history.map((h, i) => (
              <li key={i}>
                {NOTIFY_LABELS[h.type] ?? h.type}{' '}
                <span className="faint">
                  · {when(h.at)}
                  {h.device ? ` · ${h.device}` : ''}
                  {h.ip ? ` · IP ${h.ip}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {d.status === 'pending' ? (
        <div className="stack-form" style={{ gap: 8 }}>
          <p className="faint" style={{ margin: 0, fontSize: 13 }}>
            Восстановление выключит вход с кодом, отвяжет вход через сервисы, Telegram и пуши, выведет все устройства и
            сбросит пароль. Ссылка задать новый пароль уйдёт только на почту аккаунта.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" disabled={!ready} onClick={() => void decide(d.id, 'restore')}>
              Восстановить доступ
            </button>
            {!ready && <span className="faint" style={{ fontSize: 13 }}>можно после {when(d.decideAfter)}</span>}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 200 }}
              aria-label="Причина отказа"
              placeholder="Причина отказа: заказы не этого аккаунта…"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="button" className="chip" onClick={() => void decide(d.id, 'reject')}>
              Отклонить
            </button>
          </div>
        </div>
      ) : (
        <p className="faint" style={{ margin: 0, fontSize: 13 }}>
          {d.status === 'restored' ? 'Доступ восстановлен' : 'Отклонена'}
          {d.decidedAt ? ` ${when(d.decidedAt)}` : ''}
          {d.note ? `: ${d.note}` : ''}
        </p>
      )}
    </div>
  );
}
