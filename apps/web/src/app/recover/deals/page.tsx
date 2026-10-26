'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

type State = 'loading' | 'invalid' | 'open' | 'sent';

interface Deal {
  counterparty: string;
  text: string;
}

const EMPTY: Deal[] = [
  { counterparty: '', text: '' },
  { counterparty: '', text: '' },
  { counterparty: '', text: '' },
];

/**
 * «Опишите сделки» — по ссылке из письма на новую почту, когда проверки
 * личности у аккаунта нет. Другая сторона каждой сделки увидит описание в
 * своём кабинете и ответит, совпадает ли оно. Сделки аккаунта здесь не
 * показываем: их знает только владелец.
 */
function DealsInner() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>('loading');
  const [deals, setDeals] = useState<Deal[]>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return setState('invalid');
    apiFetch<{ submitted: boolean }>('/recovery/deals/status', { method: 'POST', body: JSON.stringify({ token }) })
      .then((r) => setState(r.submitted ? 'sent' : 'open'))
      .catch(() => setState('invalid'));
  }, [token]);

  const set = (i: number, patch: Partial<Deal>) =>
    setDeals((all) => all.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const filled = deals.filter((d) => d.counterparty.trim() || d.text.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (filled.length < 2) return setErr(t('Опишите хотя бы две сделки'));
    if (filled.some((d) => d.text.trim().length < 20)) return setErr(t('Опишите сделку подробнее — от 20 символов'));
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/recovery/deals', { method: 'POST', body: JSON.stringify({ token, deals: filled }) });
      setState('sent');
    } catch (e2) {
      setErr(apiErrorMessage(e2, t('Не удалось отправить описание. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 12 }}>{t('Сделки для восстановления доступа')}</h1>
      {state === 'loading' ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : state === 'invalid' ? (
        <div className="stack-form">
          <p role="alert" style={{ margin: 0 }}>{t('Ссылка недействительна или истекла')}</p>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {t('Ссылка действует неделю и только последняя из присланных. Если заявку уже решили, ответ пришёл на почту.')}
          </p>
          <Link href="/recover">{t('Подать заявку заново')}</Link>
        </div>
      ) : state === 'sent' ? (
        <p role="status" style={{ margin: 0 }}>
          {t('Описание отправлено. Участники сделок сверят его, а сотрудник ответит на эту почту — не раньше чем через 3 дня после заявки.')}
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, margin: '0 0 24px' }}>
            {t('Проверки личности у аккаунта нет, поэтому вспомните две-три сделки с разными продавцами или покупателями. Мы спросим их, совпадает ли описание, — ответ увидит только сотрудник. Нужны подтверждения хотя бы двух.')}
          </p>
          <form onSubmit={submit} className="stack-form">
            {deals.map((d, i) => (
              <fieldset key={i} className="deal-entry">
                <legend className="label">
                  {i < 2 ? t('Сделка {n}', { n: i + 1 }) : t('Сделка {n} — необязательно', { n: i + 1 })}
                </legend>
                <div className="field">
                  <label className="label" htmlFor={`dl-who-${i}`}>{t('Ник продавца или покупателя')}</label>
                  <input id={`dl-who-${i}`} className="input" autoCapitalize="none" spellCheck={false} maxLength={40}
                    value={d.counterparty} required={i < 2} onChange={(e) => set(i, { counterparty: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label" htmlFor={`dl-text-${i}`}>{t('Что было в сделке')}</label>
                  <textarea id={`dl-text-${i}`} className="input" rows={3} maxLength={600} value={d.text} required={i < 2}
                    placeholder={t('Что покупали или продавали, когда, о чём договаривались в чате')}
                    onChange={(e) => set(i, { text: e.target.value })} />
                </div>
              </fieldset>
            ))}
            <p className="hint" style={{ margin: 0 }}>
              {t('Пишите то, что помнят только участники сделки: детали из переписки, как и когда выдали товар. Номера заказов не нужны.')}
            </p>
            {err && <p role="alert" style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{err}</p>}
            <button className="btn" type="submit" disabled={busy || filled.length < 2} style={{ width: '100%' }}>
              {busy ? '…' : t('Отправить описание')}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default function RecoverDealsPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <DealsInner />
    </Suspense>
  );
}
