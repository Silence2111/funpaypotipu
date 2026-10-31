'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Clock } from 'lucide-react';
import { DISPUTE_REMIND_HOURS } from '@gamemarket/shared';
import { timeLeft } from '@/lib/format';
import { useSummary } from '@/lib/summary';
import { useT } from '@/lib/i18n/client';
import { useSessionUser } from './auth-nav';

/**
 * Плашка под шапкой на всех страницах: до конца срока ответа в споре меньше
 * DISPUTE_REMIND_HOURS часов, а ход за этим человеком. Пропущенный срок арбитр
 * видит при решении, поэтому напоминаем на сайте, а не только уведомлением.
 * Уходит сама, когда человек ответил или срок прошёл. На странице спора не
 * нужна: там срок и поле ответа.
 */
export function DisputeBanner() {
  const t = useT();
  const pathname = usePathname();
  const user = useSessionUser();
  const sum = useSummary(!!user, pathname);
  const dispute = sum?.dispute ?? null;
  // Оставшееся время — раз в минуту, без запроса к серверу.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!dispute) return;
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [dispute]);

  if (!dispute || pathname === `/disputes/${dispute.id}`) return null;
  const ms = Date.parse(dispute.respondBy) - Date.now();
  if (ms > DISPUTE_REMIND_HOURS * 3600_000) return null;
  const left = timeLeft(dispute.respondBy, t);
  if (!left) return null;

  return (
    <div className="container dispute-banner" role="status">
      <div className="alert warning">
        <Clock size={18} strokeWidth={1.75} aria-hidden style={{ color: 'var(--warning)' }} />
        <span style={{ flex: 1 }}>
          {t(
            'Спор по заказу {number} ждёт вашего ответа — осталось {left}. Без ответа арбитр учтёт молчание при решении.',
            {
              number: dispute.orderNumber,
              left,
            },
          )}
        </span>
        <Link href={`/disputes/${dispute.id}`} className="dispute-banner-link">
          {t('Ответить')}
        </Link>
      </div>
    </div>
  );
}
