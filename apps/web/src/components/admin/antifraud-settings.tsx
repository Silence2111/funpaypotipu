'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ANTIFRAUD_DEFAULTS, NEWBIE_HOURS, type AntifraudSettings } from '@gamemarket/shared/antifraud';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

type View = AntifraudSettings & { saved: boolean };

const FIELDS: Array<{ key: 'newbiePayDay' | 'paymentsPerHour' | 'newbiePaymentsPerHour' | 'newbieLotsPerDay'; label: string; hint: string; rub?: boolean }> = [
  { key: 'newbiePayDay', label: 'Оплаты новичка за сутки, ₽', hint: 'картой и по СБП', rub: true },
  { key: 'newbiePaymentsPerHour', label: 'Попыток оплаты в час у новичка', hint: 'краденые карты пробуют часто' },
  { key: 'paymentsPerHour', label: 'Попыток оплаты в час у всех', hint: '' },
  { key: 'newbieLotsPerDay', label: 'Лотов в сутки у новичка', hint: 'спам и подставные витрины' },
];

/**
 * Лимиты антифрода в консоли (часть 128) — у администратора. Новичок —
 * аккаунт моложе 72 ч без завершённых сделок. Сохранение — в журнал.
 */
export function AntifraudSettingsCard() {
  const [v, setV] = useState<View | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fill = (x: View) => {
    setV(x);
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(f.rub ? x[f.key] / 100 : x[f.key])])));
  };

  useEffect(() => {
    apiFetch<View>('/admin/antifraud').then(fill).catch(() => setMsg({ ok: false, text: 'Не удалось загрузить лимиты.' }));
  }, []);

  async function save(next: Partial<AntifraudSettings>) {
    if (!v) return;
    setBusy(true);
    setMsg(null);
    try {
      const numbers = Object.fromEntries(
        FIELDS.map((f) => [f.key, Math.round(Number(form[f.key]!.replace(/\s/g, '')) * (f.rub ? 100 : 1))]),
      );
      const body = { enabled: v.enabled, blockLinkedDeals: v.blockLinkedDeals, ...numbers, ...next };
      fill(await apiFetch<View>('/admin/antifraud', { method: 'PUT', body: JSON.stringify(body) }));
      setMsg({ ok: true, text: 'Сохранено.' });
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, 'Не удалось сохранить.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card" style={{ padding: 16 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        Лимиты антифрода{v ? (v.enabled ? ' · включены' : ' · выключены') : ''}
      </summary>
      {v && (
        <form
          style={{ display: 'grid', gap: 12, marginTop: 12 }}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void save({});
          }}
        >
          <p className="hint" style={{ margin: 0 }}>
            Новичок — аккаунт моложе {NEWBIE_HOURS} ч без завершённых сделок. Связанные аккаунты — общий браузер или
            реквизиты вывода (кроме карты: от неё у нас только первые и последние цифры).
          </p>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />
            Лимиты включены
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={v.blockLinkedDeals} onChange={(e) => setV({ ...v, blockLinkedDeals: e.target.checked })} />
            Запрет покупок у связанного аккаунта
          </label>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {FIELDS.map((f) => (
              <div key={f.key} className="field">
                <label className="label" htmlFor={`af-${f.key}`}>{f.label}</label>
                <input id={`af-${f.key}`} className="input" inputMode="numeric" value={form[f.key] ?? ''}
                  onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} />
                <span className="hint">
                  {f.hint ? `${f.hint}; ` : ''}по умолчанию {f.rub ? ANTIFRAUD_DEFAULTS[f.key] / 100 : ANTIFRAUD_DEFAULTS[f.key]}
                </span>
              </div>
            ))}
          </div>
          {msg && <div className={msg.ok ? 'alert success' : 'alert error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="submit" disabled={busy}>Сохранить</button>
            {v.saved && (
              <button type="button" className="btn ghost" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    fill(await apiFetch<View>('/admin/antifraud', { method: 'DELETE' }));
                    setMsg({ ok: true, text: 'Вернули значения по умолчанию.' });
                  } catch (e) {
                    setMsg({ ok: false, text: apiErrorMessage(e, 'Не удалось сбросить.') });
                  } finally {
                    setBusy(false);
                  }
                }}>
                По умолчанию
              </button>
            )}
          </div>
        </form>
      )}
    </details>
  );
}
