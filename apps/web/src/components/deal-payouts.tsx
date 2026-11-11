'use client';

import { useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';

/**
 * Выплаты по «Безопасной сделке» (часть 123): деньги за проданное ЮKassa
 * выплачивает по каждой сделке сама — на карту или в ЮMoney, не через
 * баланс. Здесь — сколько в пути, сколько ждёт реквизитов, и кошелёк ЮMoney
 * для выплат: сохранили — ждущие уходят сами.
 */
export function DealPayouts({
  summary,
  currency,
  onSaved,
}: {
  summary: { count: number; amount: string; waiting: number };
  currency: string;
  onSaved: () => void;
}) {
  const t = useT();
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await apiFetch('/payouts/destinations', {
        method: 'POST',
        body: JSON.stringify({ method: 'yoomoney', destination: account.trim() }),
      });
      setAccount('');
      setNote({ ok: true, text: t('Кошелёк сохранён — ждущие выплаты уйдут на него в течение минуты.') });
      onSaved();
    } catch (err) {
      setNote({ ok: false, text: apiErrorMessage(err, t('Не удалось сохранить кошелёк.')) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ padding: 20, display: 'grid', gap: 12 }} aria-labelledby="deal-payouts-title">
      <h2 className="h2" id="deal-payouts-title" style={{ fontSize: 18, margin: 0 }}>
        {t('Выплаты по сделкам')}
      </h2>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {t('Оплата идёт через «Безопасную сделку» ЮKassa: деньги за каждую продажу ЮKassa выплачивает сама, на карту или в ЮMoney, не через баланс.')}
      </p>
      <p style={{ margin: 0 }}>
        <b>{formatPrice(summary.amount, currency, t)}</b>{' '}
        <span className="faint">
          {t('в пути: {n}', { n: t.n(summary.count, 'выплата', 'выплаты', 'выплат') })}
          {summary.waiting > 0 && ` · ${t('ждут реквизиты: {n}', { n: summary.waiting })}`}
        </span>
      </p>
      {note && (
        <div className={note.ok ? 'alert success' : 'alert error'} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </div>
      )}
      <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={save}>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label className="label" htmlFor="deal-yoomoney">{t('Кошелёк ЮMoney для выплат')}</label>
          <input id="deal-yoomoney" className="input" inputMode="numeric" placeholder="4100 1234 5678 901"
            value={account} onChange={(e) => setAccount(e.target.value)} maxLength={26} />
        </div>
        <button className="btn" type="submit" disabled={busy || account.replace(/\D/g, '').length < 11}>
          {t('Сохранить')}
        </button>
      </form>
      <p className="hint" style={{ margin: 0 }}>
        {t('Кошелёк — именной или идентифицированный: на анонимный ЮKassa не выплачивает.')}
      </p>
    </section>
  );
}
