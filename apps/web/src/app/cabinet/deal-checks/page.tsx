'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';
import { msg, type T } from '@/lib/i18n/lang';

interface Check {
  id: string;
  createdAt: string;
  username: string | null;
  text: string;
  deals: Array<{
    id: string;
    number: string;
    title: string | null;
    amount: string;
    currency: string;
    completedAt: string | null;
    youSold: boolean;
  }>;
}

type Answer = 'match' | 'mismatch' | 'unsure';

const ANSWERED: Record<Answer, string> = {
  match: msg('Спасибо: ответили, что описание совпадает.'),
  mismatch: msg('Спасибо: ответили, что описание не совпадает.'),
  unsure: msg('Спасибо: ответили, что не помните.'),
};

const day = (iso: string, t: T) =>
  new Date(iso).toLocaleDateString(t.locale, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * «Подтверждение сделок»: тот, с кем вы торговали, восстанавливает доступ к
 * аккаунту без проверки личности, и в заявке есть описание сделки. Вы были в
 * ней и помните, как всё шло, — ответ увидит только сотрудник. Кнопки ответа
 * равные: подталкивать к «Совпадает» нельзя. Сюда ведёт уведомление.
 */
export default function DealChecksPage() {
  const t = useT();
  const router = useRouter();
  const [list, setList] = useState<Check[] | null>(null);
  const [done, setDone] = useState<Record<string, Answer>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/deal-checks');
      return;
    }
    apiFetch<Check[]>('/recovery/checks')
      .then(setList)
      .catch(() => setList([]));
  }, [router]);

  async function answer(id: string, a: Answer) {
    setBusy(id);
    setErr(null);
    try {
      await apiFetch(`/recovery/checks/${id}`, { method: 'POST', body: JSON.stringify({ answer: a }) });
      setDone((d) => ({ ...d, [id]: a }));
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось отправить ответ. Попробуйте ещё раз.')));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Подтверждение сделок')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t('Тот, с кем вы заключали сделки, восстанавливает доступ к аккаунту. Сверьте описание сделки из заявки с тем, что было, — ответ увидит только сотрудник.')}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {err && <div className="alert error" role="alert">{err}</div>}

      {list === null ? (
        <div className="skeleton" style={{ height: 160, maxWidth: 640 }} aria-busy="true" />
      ) : list.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{t('Просьб подтвердить сделку нет.')}</p>
      ) : (
        <div className="grid" style={{ gap: 16, maxWidth: 640 }}>
          {list.map((c) => (
            <section key={c.id} className="card stack-form" style={{ padding: 24, gap: 16 }} aria-labelledby={`dc-${c.id}`}>
              <div>
                <h2 id={`dc-${c.id}`} className="h2" style={{ fontSize: 18 }}>
                  {t('@{username} восстанавливает доступ', { username: c.username ?? '—' })}
                </h2>
                <p className="faint" style={{ margin: '4px 0 0', fontSize: 13 }}>
                  {t('просьба от {date}', { date: day(c.createdAt, t) })}
                </p>
              </div>
              <div>
                <p className="label" style={{ margin: '0 0 6px' }}>{t('Ваши завершённые сделки')}</p>
                <ul className="recovery-list">
                  {c.deals.map((o) => (
                    <li key={o.id}>
                      <Link href={`/orders/${o.id}`} className="recovery-mono">{o.number}</Link>{' '}
                      <span>{o.title ?? '—'}</span>{' '}
                      <span className="faint">
                        · {o.youSold ? t('вы продавали') : t('вы покупали')} ·{' '}
                        <span className="recovery-mono">{formatPrice(o.amount, o.currency, t)}</span>
                        {o.completedAt ? ` · ${day(o.completedAt, t)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="label" style={{ margin: '0 0 6px' }}>{t('Описание из заявки')}</p>
                <p className="deal-quote">{c.text}</p>
              </div>
              {done[c.id] ? (
                <p role="status" className="muted" style={{ margin: 0 }}>{t(ANSWERED[done[c.id]!])}</p>
              ) : (
                <div className="stack-form" style={{ gap: 8 }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{t('Описание совпадает с тем, что было в сделке?')}</p>
                  <div className="deal-answers">
                    <button type="button" className="btn secondary" disabled={busy === c.id} onClick={() => void answer(c.id, 'match')}>
                      {t('Совпадает')}
                    </button>
                    <button type="button" className="btn secondary" disabled={busy === c.id} onClick={() => void answer(c.id, 'mismatch')}>
                      {t('Не совпадает')}
                    </button>
                    <button type="button" className="btn secondary" disabled={busy === c.id} onClick={() => void answer(c.id, 'unsure')}>
                      {t('Не помню')}
                    </button>
                  </div>
                  <p className="hint" style={{ margin: 0 }}>
                    {t('Ответ изменить нельзя. Если вас просят подтвердить в переписке или за вознаграждение, это повод ответить «Не совпадает».')}
                  </p>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
