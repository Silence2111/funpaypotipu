'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { User, LogOut, ShieldCheck } from 'lucide-react';
import { clearSession, getUser, isStaff, type SessionUser } from '@/lib/session';
import { NotificationsBell } from './notifications-bell';

export function AuthNav() {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    const sync = () => setUser(getUser());
    sync();
    window.addEventListener('gm-auth', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('gm-auth', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (!user) {
    return (
      <Link href="/login" className="chip">
        Войти
      </Link>
    );
  }

  return (
    <div className="row" style={{ gap: 8 }}>
      {isStaff(user) && (
        // На телефоне шапка и так впритык — там консоль открывается из кабинета.
        <Link href="/admin" className="chip hide-mobile" aria-label="Консоль сотрудника" title="Консоль сотрудника">
          <ShieldCheck size={16} strokeWidth={1.75} />
          <span>Консоль</span>
        </Link>
      )}
      <NotificationsBell />
      <Link href="/cabinet" className="chip" aria-label="Кабинет">
        <User size={16} strokeWidth={1.75} />
        <span className="hide-mobile" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.username}
        </span>
      </Link>
      <button className="chip hide-mobile" onClick={() => clearSession()} aria-label="Выйти" title="Выйти" type="button">
        <LogOut size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
