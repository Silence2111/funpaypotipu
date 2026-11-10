'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/**
 * Ссылка из письма на новую почту: открыли — почта аккаунта сменена и
 * подтверждена. Прежней почте в этот момент уходит письмо «Это не я».
 */
function ConfirmInner() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Ссылка одноразовая: второй запрос ответил бы «недействительна» поверх успеха.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) return setErr(t('Ссылка недействительна или истекла'));
    apiFetch<{ email: string }>('/auth/email/confirm', { method: 'POST', body: JSON.stringify({ token }) })
      .then((r) => setEmail(r.email))
      .catch((e) => setErr(apiErrorMessage(e, t('Ссылка недействительна или истекла'))));
  }, [token, t]);

  return (
    <div style={{ maxWidth: 440, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 12 }}>{t('Новая почта')}</h1>
      {email ? (
        <div className="stack-form">
          <p role="status" style={{ margin: 0 }}>
            {t('Готово: почта аккаунта — {email}. Входите с ней и тем же паролем.', { email })}
          </p>
          <Link href="/cabinet/security">{t('В «Безопасность»')}</Link>
        </div>
      ) : err ? (
        <div className="stack-form">
          <p role="alert" style={{ margin: 0 }}>{err}</p>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {t('Ссылка действует сутки и только последняя из присланных. Попросите новую в «Безопасности».')}
          </p>
        </div>
      ) : (
        <div className="skeleton" style={{ height: 80 }} aria-busy="true" />
      )}
    </div>
  );
}

export default function EmailConfirmPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <ConfirmInner />
    </Suspense>
  );
}
