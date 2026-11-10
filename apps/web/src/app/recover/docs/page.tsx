'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { uploadViaPresignedUrl } from '@/lib/upload';
import { FilePick, type Picked } from '@/components/file-pick';
import { useT } from '@/lib/i18n/client';

type State = 'loading' | 'invalid' | 'open' | 'sent';

/**
 * «Загрузите документы» — по ссылке из письма на новую почту из заявки «Не
 * могу войти». Тот же документ, что при проверке личности, и селфи с ним:
 * сотрудник сверит их с одобренными раньше. Без входа — по токену из письма.
 */
function DocsInner() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>('loading');
  const [doc, setDoc] = useState<Picked[]>([]);
  const [selfie, setSelfie] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return setState('invalid');
    apiFetch<{ submitted: boolean }>('/recovery/docs/status', { method: 'POST', body: JSON.stringify({ token }) })
      .then((r) => setState(r.submitted ? 'sent' : 'open'))
      .catch(() => setState('invalid'));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!doc.length || !selfie.length) return setErr(t('Нужны фото документа и селфи с ним'));
    setBusy(true);
    setErr(null);
    try {
      const all = [...doc, ...selfie];
      const keys: string[] = [];
      for (const [i, p] of all.entries()) {
        setProgress(t('{i} из {n}', { i: i + 1, n: all.length }));
        keys.push((await uploadViaPresignedUrl('/recovery/docs/uploads', p.file, { token })).key);
      }
      setProgress(null);
      await apiFetch('/recovery/docs', {
        method: 'POST',
        body: JSON.stringify({ token, documentKeys: keys.slice(0, doc.length), selfieKey: keys[doc.length] }),
      });
      setState('sent');
    } catch (e2) {
      setErr(apiErrorMessage(e2, t('Не удалось отправить документы. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 12 }}>{t('Документы для восстановления доступа')}</h1>
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
          {t('Документы отправлены. Сотрудник сверит их с проверкой личности и ответит на эту почту.')}
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, margin: '0 0 24px' }}>
            {t('Сфотографируйте тот же документ, что при проверке личности, и сделайте селфи с ним. Сотрудник сверит их и решит, вернуть ли вам аккаунт.')}
          </p>
          <form onSubmit={submit} className="stack-form">
            <FilePick
              id="rc-doc"
              label={t('Документ')}
              hint={t('Паспорт или другой документ с фото: разворот с фотографией целиком, без бликов. Можно добавить второе фото.')}
              max={2}
              files={doc}
              onChange={setDoc}
            />
            <FilePick
              id="rc-selfie"
              label={t('Селфи с документом')}
              hint={t('Лицо и раскрытый документ в одном кадре — так видно, что документ ваш.')}
              max={1}
              files={selfie}
              onChange={setSelfie}
            />
            <p className="hint" style={{ margin: 0 }}>
              {t('Фото или PDF до 15 МБ. Документы видит только сотрудник проверки — другим пользователям они недоступны.')}
            </p>
            {err && <p role="alert" style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{err}</p>}
            <button className="btn" type="submit" disabled={busy || !doc.length || !selfie.length} style={{ width: '100%' }}>
              {busy ? (progress ?? '…') : t('Отправить документы')}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default function RecoverDocsPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <DocsInner />
    </Suspense>
  );
}
