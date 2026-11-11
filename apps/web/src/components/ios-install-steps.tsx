'use client';

import { Share, SquarePlus, BellRing } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

/**
 * Как поставить сайт на iPhone (часть 139): Safari ставит его только через
 * «Поделиться → На экран „Домой“» — кнопки установки у него нет. После
 * установки приходят пуши: iPhone даёт их только сайтам с экрана «Домой».
 */
export function IosInstallSteps() {
  const t = useT();
  const steps = [
    { icon: <Share size={20} strokeWidth={1.75} aria-hidden />, text: t('Откройте сайт в Safari и нажмите «Поделиться» внизу экрана.') },
    { icon: <SquarePlus size={20} strokeWidth={1.75} aria-hidden />, text: t('Выберите «На экран „Домой“» и нажмите «Добавить».') },
    { icon: <BellRing size={20} strokeWidth={1.75} aria-hidden />, text: t('Откройте GameMarket с иконки и включите уведомления: «Профиль» → «Настройки» → «Уведомления».') },
  ];
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
      {steps.map((s, i) => (
        <li key={i} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="badge" style={{ minWidth: 36, justifyContent: 'center' }}>{s.icon}</span>
          <span style={{ fontSize: 15, lineHeight: 1.5 }}>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}
