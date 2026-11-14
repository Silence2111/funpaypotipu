'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadFile } from '@/lib/download';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/**
 * «Скачать мои данные» (к части 124, ст. 14 152-ФЗ): всё, что площадка
 * знает о человеке, — одним файлом. Реквизиты выплат — только способ.
 */
export function DataExport() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      await downloadFile('/account/export');
    } catch (e) {
      setErr(apiErrorMessage(e, t('Файл не скачался. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack-form" style={{ padding: 24, gap: 12 }}>
      <h2 className="h2" style={{ fontSize: 18, margin: 0 }}>
        {t('Мои данные')}
      </h2>
      <p className="hint" style={{ margin: 0 }}>
        {t(
          'Всё, что площадка знает о вас, одним файлом: профиль, согласия, входы, заказы, лоты, сообщения, отзывы, обращения и выплаты. Номера карт и кошельков в файл не попадают.',
        )}
      </p>
      <div>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void run()}>
          <Download size={16} strokeWidth={1.75} aria-hidden />{' '}
          {busy ? t('Готовим файл…') : t('Скачать мои данные')}
        </button>
      </div>
      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}
    </section>
  );
}
