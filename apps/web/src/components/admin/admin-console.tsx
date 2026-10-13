'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { ReportsSection } from './reports-section';
import { DisputesSection } from './disputes-section';
import { ListingsSection } from './listings-section';
import { UsersSection } from './users-section';
import { KycSection, PayoutsSection } from './finance-sections';
import { FeesSection } from './fees-section';
import { AuditSection } from './audit-section';

/** Разделы консоли и роли, которым они открыты. Администратору открыто всё. */
const TABS = [
  { key: 'reports', label: 'Жалобы', roles: ['moderator'] },
  { key: 'disputes', label: 'Споры', roles: ['agent'] },
  { key: 'listings', label: 'Лоты', roles: ['moderator'] },
  { key: 'users', label: 'Пользователи', roles: ['moderator'] },
  { key: 'payouts', label: 'Выплаты', roles: ['finance'] },
  { key: 'kyc', label: 'Верификация', roles: ['moderator'] },
  { key: 'fees', label: 'Комиссии и промокоды', roles: [] as string[] },
  { key: 'audit', label: 'Журнал', roles: [] as string[] },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * Консоль сотрудника. Раньше модерация, споры, комиссии и роли были только
 * в API: заблокировать лот или решить спор можно было запросом из консоли
 * разработчика. Каждый видит только свои разделы; права проверяет API.
 */
export function AdminConsole() {
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<{ userId: string; roles: string[] } | null | undefined>(undefined);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/admin');
      return;
    }
    apiFetch<{ userId: string; roles: string[] }>('/auth/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, [router]);

  if (me === undefined) return <div className="container" style={{ paddingTop: 48 }} aria-busy="true" />;

  const roles = me?.roles ?? [];
  const isAdmin = roles.includes('admin');
  const tabs = TABS.filter((t) => isAdmin || t.roles.some((r) => roles.includes(r)));
  const requested = params.get('tab') as TabKey | null;
  const tab = tabs.find((t) => t.key === requested) ?? tabs[0];

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>Консоль</h1>
        {tabs.length > 0 && (
          <nav aria-label="Разделы консоли" className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            {tabs.map((t) => (
              <Link key={t.key} href={`/admin?tab=${t.key}`} className="chip" aria-current={t.key === tab?.key ? 'page' : undefined}>
                {t.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {!tab ? (
        <p className="muted">Консоль — для сотрудников площадки. У вашего аккаунта нет ролей модератора, арбитра или финансов.</p>
      ) : tab.key === 'reports' ? (
        <ReportsSection />
      ) : tab.key === 'disputes' ? (
        <DisputesSection />
      ) : tab.key === 'listings' ? (
        <ListingsSection />
      ) : tab.key === 'users' ? (
        <UsersSection isAdmin={isAdmin} meId={me?.userId ?? null} />
      ) : tab.key === 'payouts' ? (
        <PayoutsSection />
      ) : tab.key === 'kyc' ? (
        <KycSection />
      ) : tab.key === 'fees' ? (
        <FeesSection />
      ) : (
        <AuditSection />
      )}
    </div>
  );
}
