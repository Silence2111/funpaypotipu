'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

type State = 'loading' | 'invalid' | 'open' | 'waiting' | 'done';

interface Status {
  state: 'open' | 'waiting' | 'done';
  failed?: boolean;
}

/**
 * «Проверка картой» — по ссылке из письма на новую почту. Заявитель платит
 * 1 ₽ картой, которой платили в аккаунте: ЮKassa только блокирует сумму, по
 * ней видно первые 6 и последние 4 цифры, и блокировка сразу снимается.
 * Совпала ли карта, здесь не говорим — это решает сотрудник.
 */
function CardInner() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>('loading');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const check = useCallback(async () => {
    const r = await apiFetch<Status>('/recovery/card/status', { method: 'POST', body: JSON.stringify({ token }) });
    setFailed(!!r.failed);
    setState(r.state);
    return r.state;
  }, [token]);

  useEffect(() => {
    if (!token) return setState('invalid');
    let stop = false;
    // Вернулись со страницы ЮKassa — банк мог ещё не ответить: спрашиваем ещё минуту.
    (async () => {
      for (let i = 0; i < 30 && !stop; i++) {
        if ((await check()) !== 'waiting') return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    })().catch(() => setState('invalid'));
    return () => {
      stop = true;
    };
  }, [token, check]);

  async function pay() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<{ url: string }>('/recovery/card/pay', { method: 'POST', body: JSON.stringify({ token }) });
      window.location.href = r.url;
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось перейти к оплате. Попробуйте ещё раз.')));
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 12 }}>{t('Проверка картой')}</h1>
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
      ) : state === 'done' ? (
        <p role="status" style={{ margin: 0 }}>
          {t('Готово: блокировка 1 ₽ снята. Сотрудник сверит карту и ответит на эту почту — не раньше чем через 3 дня после заявки.')}
        </p>
      ) : state === 'waiting' ? (
        <p role="status" className="muted" style={{ margin: 0 }} aria-busy="true">
          {t('Ждём ответа банка…')}
        </p>
      ) : (
        <div className="stack-form">
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {t('Заплатите 1 ₽ картой, которой вы платили на GameMarket или на которую выводили деньги. Сумма только заблокируется на карте и сразу вернётся, а мы сверим первые 6 и последние 4 цифры с прошлыми оплатами.')}
          </p>
          {failed && (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>
              {t('Оплата не прошла. Попробуйте ещё раз — той же картой или другой, которой платили на GameMarket.')}
            </p>
          )}
          {err && <p role="alert" style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{err}</p>}
          <button className="btn" type="button" disabled={busy} onClick={() => void pay()} style={{ width: '100%' }}>
            <CreditCard size={18} strokeWidth={1.75} aria-hidden /> {busy ? '…' : t('Заплатить 1 ₽ картой')}
          </button>
          <p className="hint" style={{ margin: 0 }}>
            {t('Номер карты вводится на странице ЮKassa — площадка его не видит и не хранит.')}
          </p>
        </div>
      )}
    </div>
  );
}

export default function RecoverCardPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <CardInner />
    </Suspense>
  );
}
