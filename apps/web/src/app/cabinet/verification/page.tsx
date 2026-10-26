'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ShieldCheck } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { uploadViaPresignedUrl } from '@/lib/upload';
import { formatPrice } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';
import { FilePick, type Picked } from '@/components/file-pick';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';

interface Kyc {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  reason?: string | null;
  createdAt?: string;
  reviewedAt?: string | null;
}

const when = (t: T, iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString(t.locale, {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/**
 * Проверка личности продавца: фото документа и селфи с ним. Раньше API для
 * неё был, а страницы не было: вывод больше порога шёл только через
 * поддержку, а ошибка вывода отсылала в несуществующий раздел.
 */
export default function VerificationPage() {
  const t = useT();
  const router = useRouter();
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const [kycAbove, setKycAbove] = useState<string | null>(null);
  const [doc, setDoc] = useState<Picked[]>([]);
  const [selfie, setSelfie] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setKyc(await apiFetch<Kyc>('/kyc/me'));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/verification');
      return;
    }
    load().catch(() => setErr(t('Не удалось загрузить статус проверки')));
    apiFetch<{ payoutKycAboveMinor?: string }>('/fees/public')
      .then((p) => setKycAbove(p.payoutKycAboveMinor ?? null))
      .catch(() => {});
  }, [router, load, t]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!doc.length || !selfie.length) {
      setErr(t('Нужны фото документа и селфи с ним'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const all = [...doc, ...selfie];
      const keys: string[] = [];
      for (const [i, p] of all.entries()) {
        setProgress(t('{i} из {n}', { i: i + 1, n: all.length }));
        keys.push((await uploadViaPresignedUrl('/kyc/uploads', p.file)).key);
      }
      setProgress(null);
      setKyc(
        await apiFetch<Kyc>('/kyc', {
          method: 'POST',
          body: JSON.stringify({
            documentKeys: keys.slice(0, doc.length),
            selfieKey: keys[doc.length],
          }),
        }),
      );
      setDoc([]);
      setSelfie([]);
    } catch (e2) {
      setErr(apiErrorMessage(e2, t('Не удалось отправить документы. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const limit = formatPrice(kycAbove ?? '1500000', 'RUB', t);
  const canSend = kyc && (kyc.status === 'none' || kyc.status === 'rejected');

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Проверка личности')}
        </h1>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <section className="card" style={{ padding: 24, maxWidth: 600 }}>
        {kyc === null ? (
          <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
        ) : kyc.status === 'approved' ? (
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <ShieldCheck size={22} strokeWidth={1.75} color="var(--success)" aria-hidden />
            <div>
              <p style={{ margin: 0, fontWeight: 700 }}>{t('Документы проверены')}</p>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 15 }}>
                {t(
                  '{date}. Вывод — без ограничения суммы, в профиле и на ваших лотах — «Документы проверены».',
                  {
                    date: when(t, kyc.reviewedAt),
                  },
                )}
              </p>
            </div>
          </div>
        ) : kyc.status === 'pending' ? (
          <div role="status">
            <p style={{ margin: 0, fontWeight: 700 }}>{t('Документы на проверке')}</p>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 15 }}>
              {t('Отправлены {date}. Решение придёт уведомлением.', {
                date: when(t, kyc.createdAt),
              })}
            </p>
          </div>
        ) : (
          <>
            {kyc.status === 'rejected' && (
              <div className="alert error" role="alert" style={{ marginBottom: 16 }}>
                {kyc.reason
                  ? t('Документы не приняты: {reason}. Загрузите их заново.', {
                      reason: kyc.reason,
                    })
                  : t('Документы не приняты. Загрузите их заново.')}
              </div>
            )}
            <h2 className="h2" style={{ fontSize: 18, margin: 0 }}>
              {t('Что даёт проверка')}
            </h2>
            <ul className="kyc-perks">
              <li>
                <Check size={16} strokeWidth={1.75} aria-hidden />{' '}
                {t('Вывод без ограничения суммы — без проверки за раз можно вывести до {limit}', {
                  limit,
                })}
              </li>
              <li>
                <Check size={16} strokeWidth={1.75} aria-hidden />{' '}
                {t('«Документы проверены» в профиле и в карточке продавца на ваших лотах')}
              </li>
              <li>
                <Check size={16} strokeWidth={1.75} aria-hidden />{' '}
                {t('Уровень Pro — когда хватит продаж и оценок')}
              </li>
            </ul>
          </>
        )}
      </section>

      {canSend && (
        <form
          onSubmit={submit}
          className="card stack-form"
          style={{ padding: 24, maxWidth: 600, gap: 18 }}
          noValidate
        >
          <FilePick
            id="kyc-doc"
            label={t('Документ')}
            hint={t(
              'Паспорт или другой документ с фото: разворот с фотографией целиком, без бликов. Можно добавить второе фото.',
            )}
            max={2}
            files={doc}
            onChange={setDoc}
          />
          <FilePick
            id="kyc-selfie"
            label={t('Селфи с документом')}
            hint={t('Лицо и раскрытый документ в одном кадре — так видно, что документ ваш.')}
            max={1}
            files={selfie}
            onChange={setSelfie}
          />
          <p className="hint" style={{ margin: 0 }}>
            {t(
              'Фото или PDF до 15 МБ. Документы видит только сотрудник проверки — другим пользователям они недоступны.',
            )}
          </p>
          {err && (
            <div className="alert error" role="alert">
              {err}
            </div>
          )}
          <div>
            <button className="btn" type="submit" disabled={busy || !doc.length || !selfie.length}>
              {busy
                ? progress
                  ? t('Отправляем {progress}…', { progress })
                  : t('Отправляем…')
                : t('Отправить на проверку')}
            </button>
          </div>
        </form>
      )}
      {!canSend && err && (
        <div className="alert error" role="alert" style={{ maxWidth: 600 }}>
          {err}
        </div>
      )}
    </div>
  );
}
