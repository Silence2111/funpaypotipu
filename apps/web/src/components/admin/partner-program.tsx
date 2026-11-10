'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { PARTNER_MAX_SHARE_BPS, PARTNER_MAX_TERM_DAYS } from '@gamemarket/shared/partner';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';

type View = {
  settings: { enabled: boolean; shareBps: number; termDays: number };
  active: boolean;
  totals: { partners: number; referred: number; deals: number; accrued: string };
};

/**
 * Партнёрская программа (часть 116): включена ли, доля партнёра и срок —
 * только у администратора; каждое изменение — в журнале. По умолчанию
 * выключена и без цифр: цифры — решение владельца.
 */
export function PartnerProgramCard() {
  const [view, setView] = useState<View | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [share, setShare] = useState('');
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (v: View) => {
    setView(v);
    setEnabled(v.settings.enabled);
    setShare(v.settings.shareBps ? String(v.settings.shareBps / 100) : '');
    setTerm(v.settings.termDays ? String(v.settings.termDays) : '');
  };

  useEffect(() => {
    apiFetch<View>('/admin/partner-program')
      .then(apply)
      .catch((e) =>
        setMsg({ ok: false, text: apiErrorMessage(e, 'Не удалось загрузить программу.') }),
      );
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    const pct = share.trim() ? Number(share.replace(',', '.')) : 0;
    const days = term.trim() ? Number(term) : 0;
    const bps = Math.round(pct * 100);
    if (!Number.isFinite(pct) || bps < 0 || bps > PARTNER_MAX_SHARE_BPS) {
      setMsg({ ok: false, text: `Доля — от 0 до ${PARTNER_MAX_SHARE_BPS / 100}%.` });
      return;
    }
    if (!Number.isInteger(days) || days < 0 || days > PARTNER_MAX_TERM_DAYS) {
      setMsg({ ok: false, text: `Срок — целым числом дней, до ${PARTNER_MAX_TERM_DAYS}.` });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const v = await apiFetch<View>('/admin/partner-program', {
        method: 'PUT',
        body: JSON.stringify({ enabled, shareBps: bps, termDays: days }),
      });
      apply(v);
      setMsg({
        ok: true,
        text: v.active ? 'Сохранено: программа работает.' : 'Сохранено: программа выключена.',
      });
    } catch (er) {
      setMsg({ ok: false, text: apiErrorMessage(er, 'Не удалось сохранить.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="h2" style={{ fontSize: 18, marginBottom: 6 }}>
        Партнёрская программа
      </h2>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 14, maxWidth: '70ch' }}>
        Партнёр приводит людей ссылкой или кодом. С каждой завершённой сделки привлечённого в срок
        ему уходит доля того, что осталось площадке после эквайринга и кэшбэка, — на баланс, вывод
        обычный. Сделки с самим партнёром и спорные — без начисления.
      </p>
      {msg && (
        <div
          className={msg.ok ? 'alert success' : 'alert error'}
          role={msg.ok ? 'status' : 'alert'}
          style={{ marginBottom: 12 }}
        >
          {msg.text}
        </div>
      )}
      {view === null ? (
        !msg && <div className="skeleton" style={{ height: 80 }} aria-busy="true" />
      ) : (
        <>
          <form
            onSubmit={save}
            className="row"
            style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <label className="row" style={{ gap: 8, alignItems: 'center', minHeight: 44 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Включена
            </label>
            {/* Подписи видны и с заполненными полями: «20» и «180» без них не прочесть. */}
            <label className="field" style={{ maxWidth: 220 }}>
              <span className="label">Доля партнёра, % остатка</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="например, 20"
                value={share}
                onChange={(e) => setShare(e.target.value)}
              />
            </label>
            <label className="field" style={{ maxWidth: 220 }}>
              <span className="label">Срок, дней после привязки</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="например, 180"
                value={term}
                onChange={(e) => setTerm(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <button className="btn secondary" type="submit" disabled={busy}>
              Сохранить программу
            </button>
          </form>
          <p className="hint" style={{ marginTop: 8 }}>
            {view.active
              ? `Работает: ${view.settings.shareBps / 100}% остатка площадки, ${view.settings.termDays} дн. после привязки.`
              : 'Выключена: коды не выдаются, переходы и сделки не считаются.'}{' '}
            Партнёров {view.totals.partners}, привлечено {view.totals.referred}, сделок{' '}
            {view.totals.deals}, начислено {formatPrice(view.totals.accrued)}. Изменения — в
            журнале.
          </p>
        </>
      )}
    </div>
  );
}
