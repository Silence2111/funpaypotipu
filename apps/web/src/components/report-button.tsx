'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flag } from 'lucide-react';
import { apiFetch, getToken, useSession } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

/** Причины — как в форме жалобы FunPay: модератору проще разбирать очередь по типам. */
const REASONS = ['Мошенничество', 'Запрещённый товар', 'Контакты вне площадки', 'Оскорбления', 'Другое'];

/**
 * «Пожаловаться» на лот или пользователя. Жалоба уходит в очередь
 * модератора; решение приходит в уведомления. Владельцу своего лота и
 * себе кнопка не показывается.
 */
export function ReportButton({
  targetType,
  targetId,
  ownerId,
}: {
  targetType: 'listing' | 'user';
  targetId: string;
  /** Чей лот или профиль: себе жаловаться не нужно. */
  ownerId: string;
}) {
  const router = useRouter();
  const { ready, user } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!ready || user?.id === ownerId) return null;

  async function send() {
    if (!reason) return setErr('Выберите причину');
    if (reason === 'Другое' && details.trim().length < 3) return setErr('Опишите, что не так');
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/reports', {
        method: 'POST',
        body: JSON.stringify({ targetType, targetId, reason, ...(details.trim() ? { details: details.trim() } : {}) }),
      });
      setDone(true);
      setOpen(false);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось отправить жалобу. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="hint" role="status" style={{ margin: 0 }}>
        Жалоба отправлена. Решение модератора придёт в уведомления.
      </p>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      {!open && (
        <button
          type="button"
          className="chip"
          onClick={() => {
            if (!getToken()) return router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
            setOpen(true);
          }}
        >
          <Flag size={15} strokeWidth={1.75} /> Пожаловаться
        </button>
      )}
      {open && (
        <div className="card flat" style={{ padding: 16, background: 'var(--page)' }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ padding: 0, marginBottom: 8 }}>
              {targetType === 'listing' ? 'Что не так с лотом' : 'Что не так с пользователем'}
            </legend>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {REASONS.map((r) => (
                <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
                  {r}
                </button>
              ))}
            </div>
          </fieldset>
          <textarea
            className="input"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={2000}
            placeholder="Подробности для модератора — необязательно"
            aria-label="Подробности"
            style={{ resize: 'vertical', marginTop: 12 }}
          />
          {err && (
            <p className="field-error" role="alert" style={{ marginTop: 8 }}>
              {err}
            </p>
          )}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            {/* Не акцентная: акцент на странице лота — у «Оплатить». */}
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void send()}>
              {busy ? 'Отправляем…' : 'Отправить жалобу'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
