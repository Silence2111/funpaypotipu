'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { APPEAL_REVIEW_HOURS, APPEAL_WINDOW_DAYS, ruleAnchor, ruleClause } from '@gamemarket/shared/rules';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface Decision {
  id: string;
  kind: string;
  reason: string | null;
  rule: string | null;
  ruleText: string | null;
  createdAt: string;
  subject: string | null;
  canAppeal: boolean;
  appeal: { status: 'open' | 'upheld' | 'overturned'; text: string; note: string | null; createdAt: string; decidedAt: string | null; dueAt: string } | null;
}

const STATUS: Record<string, string> = {
  open: msg('Обжалование на рассмотрении'),
  upheld: msg('Решение оставлено в силе'),
  overturned: msg('Решение отменено'),
};

/**
 * Решения модерации о человеке (часть 134): что решили, по какому пункту
 * правил и почему; каждое можно обжаловать один раз — решит другой
 * сотрудник, ответ — в срок. Раньше было одно уведомление «статус изменён».
 */
export default function DecisionsPage() {
  const t = useT();
  const router = useRouter();
  const [list, setList] = useState<Decision[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setList(await apiFetch<Decision[]>('/account/decisions')), []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/decisions');
      return;
    }
    load().catch((e) => setErr(apiErrorMessage(e, t('Не удалось загрузить решения.'))));
  }, [router, load, t]);

  const when = (iso: string) => new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  async function send(e: FormEvent, d: Decision) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/account/decisions/${d.id}/appeal`, { method: 'POST', body: JSON.stringify({ text: text.trim() }) });
      setOpen(null);
      setText('');
      await load();
    } catch (ex) {
      setErr(apiErrorMessage(ex, t('Не удалось отправить обжалование.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Решения модерации')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t('Что решили модераторы о вас, ваших лотах и сообщениях, по какому пункту правил и почему. Не согласны — обжалуйте: решит другой сотрудник.')}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {err && <div className="alert error" role="alert">{err}</div>}

      {list === null ? (
        <div className="skeleton" style={{ height: 160, maxWidth: 640 }} aria-busy="true" />
      ) : list.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{t('Решений о вас нет.')}</p>
      ) : (
        <div className="grid" style={{ gap: 16, maxWidth: 640 }}>
          {list.map((d) => (
            <section key={d.id} className="card" style={{ padding: 20, display: 'grid', gap: 8 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <b>{t.d(d.kind)}</b>
                <span className="faint" style={{ fontSize: 13 }}>{when(d.createdAt)}</span>
              </div>
              {d.subject && <p className="muted" style={{ margin: 0, wordBreak: 'break-word' }}>«{d.subject}»</p>}
              {d.rule && ruleClause(d.rule) && (
                <p style={{ margin: 0, fontSize: 15 }}>
                  <Link href={`/rules#${ruleAnchor(d.rule)}`} style={{ color: 'var(--accent)' }}>
                    {t('Пункт {n} правил', { n: d.rule })}
                  </Link>
                  {' — '}{t.d(ruleClause(d.rule)!.title)}
                </p>
              )}
              {d.reason && <p style={{ margin: 0, fontSize: 15 }}>{t('Причина: {reason}', { reason: d.reason })}</p>}

              {d.appeal ? (
                <div className="card flat" style={{ padding: 12, background: 'var(--page)', display: 'grid', gap: 4 }}>
                  <b style={{ fontSize: 14 }}>{t(STATUS[d.appeal.status]!)}</b>
                  {d.appeal.status === 'open' && (
                    <span className="hint">{t('Ответим до {date}.', { date: when(d.appeal.dueAt) })}</span>
                  )}
                  {d.appeal.note && <span style={{ fontSize: 14 }}>{t('Ответ: {note}', { note: d.appeal.note })}</span>}
                </div>
              ) : d.canAppeal ? (
                open === d.id ? (
                  <form onSubmit={(e) => void send(e, d)} style={{ display: 'grid', gap: 8 }}>
                    <label className="label" htmlFor={`ap-${d.id}`}>{t('Почему решение неверно')}</label>
                    <textarea id={`ap-${d.id}`} className="input" rows={4} maxLength={2000} value={text}
                      onChange={(e) => setText(e.target.value)} style={{ resize: 'vertical' }} />
                    <span className="hint">
                      {t('Обжаловать можно один раз. Решит другой сотрудник, не тот, кто принимал решение, — в течение {hours} ч.', { hours: APPEAL_REVIEW_HOURS })}
                    </span>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn" type="submit" disabled={busy || text.trim().length < 10}>{t('Отправить')}</button>
                      <button className="btn ghost" type="button" onClick={() => setOpen(null)}>{t('Отмена')}</button>
                    </div>
                  </form>
                ) : (
                  <div>
                    <button className="btn secondary" type="button" onClick={() => { setOpen(d.id); setText(''); }}>{t('Обжаловать')}</button>
                  </div>
                )
              ) : (
                <span className="hint">{t('Срок обжалования — {days} дней — прошёл.', { days: APPEAL_WINDOW_DAYS })}</span>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
