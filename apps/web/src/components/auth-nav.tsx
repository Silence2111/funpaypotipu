'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { User, LogOut } from 'lucide-react';
import { clearSession, getUser, type SessionUser } from '@/lib/session';
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
      <NotificationsBell />
      <Link href="/cabinet" className="chip">
        <User size={16} strokeWidth={1.75} />
        {user.username}
      </Link>
      <button className="chip" onClick={() => clearSession()} aria-label="Выйти" type="button">
        <LogOut size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
