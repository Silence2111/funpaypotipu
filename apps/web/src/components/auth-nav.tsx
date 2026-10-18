'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, LogOut, MessagesSquare } from 'lucide-react';
import { apiFetch, clearSession, getUser, isStaff, type SessionUser } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { NotificationsBell } from './notifications-bell';

/** Ответ `GET /account/summary` — счётчики шапки. */
interface Summary {
  unreadMessages: number;
  unreadNotifications: number;
  balance: { currency: string; available: string };
  sales: { toDeliver: number };
  purchases: { toConfirm: number };
}

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
  return <UserBar user={user} />;
}

/**
 * Шапка вошедшего, как у FunPay: сообщения со счётчиком, уведомления,
 * баланс и меню профиля, где видно продажи, которые ждут выдачи, и
 * покупки, которые ждут подтверждения.
 */
function UserBar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const [sum, setSum] = useState<Summary | null>(null);

  const load = useCallback(() => {
    apiFetch<Summary>('/account/summary')
      .then(setSum)
      .catch(() => {});
  }, []);

  // Свежие счётчики: раз в полминуты, при возврате на вкладку и при переходе
  // (прочитал диалог — счётчик погас).
  useEffect(() => {
    const t = setInterval(load, 30_000);
    window.addEventListener('focus', load);
    // Мессенджер сообщает о прочтении и о новых сообщениях сам.
    window.addEventListener('gm-unread', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', load);
      window.removeEventListener('gm-unread', load);
    };
  }, [load]);
  useEffect(load, [pathname, load]);

  const unread = sum?.unreadMessages ?? 0;
  const waiting = (sum?.sales.toDeliver ?? 0) + (sum?.purchases.toConfirm ?? 0);

  return (
    <div className="row user-bar">
      <Link
        href="/chat"
        className="chip"
        aria-label={unread ? `Сообщения: ${unread} непрочитанных` : 'Сообщения'}
        title="Сообщения"
        aria-current={pathname.startsWith('/chat') ? 'page' : undefined}
      >
        <MessagesSquare size={16} strokeWidth={1.75} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </Link>
      <NotificationsBell />
      {sum && (
        <Link href="/cabinet" className="chip hide-mobile balance-chip" title="Баланс — пополнить и вывести в кабинете">
          {formatPrice(sum.balance.available, sum.balance.currency)}
        </Link>
      )}
      <UserMenu user={user} sum={sum} waiting={waiting} />
    </div>
  );
}

function UserMenu({ user, sum, waiting }: { user: SessionUser; sum: Summary | null; waiting: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toDeliver = sum?.sales.toDeliver ?? 0;
  const toConfirm = sum?.purchases.toConfirm ?? 0;

  return (
    <div className="user-menu" ref={box}>
      <button
        type="button"
        className="chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Меню профиля ${user.username}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" style={{ width: 24, height: 24, fontSize: 12 }} aria-hidden>
          {user.username.charAt(0).toUpperCase()}
        </span>
        <span className="hide-mobile user-name">{user.username}</span>
        {waiting > 0 && <span className="notif-badge">{waiting}</span>}
        <ChevronDown size={14} strokeWidth={1.75} className="hide-mobile" aria-hidden />
      </button>
      {open && (
        <div className="menu-pop" role="menu" aria-label="Профиль">
          <div className="menu-head">
            <div style={{ fontWeight: 700 }}>{user.username}</div>
            {sum && (
              <div className="faint" style={{ fontSize: 13 }}>
                Баланс {formatPrice(sum.balance.available, sum.balance.currency)}
              </div>
            )}
          </div>
          <Link role="menuitem" href="/cabinet/orders?role=seller">
            Продажи
            {toDeliver > 0 && <span className="menu-count">{toDeliver} ждут выдачи</span>}
          </Link>
          <Link role="menuitem" href="/cabinet/orders?role=buyer">
            Покупки
            {toConfirm > 0 && <span className="menu-count">{toConfirm} ждут подтверждения</span>}
          </Link>
          <Link role="menuitem" href="/cabinet/lots">
            Мои лоты
          </Link>
          <Link role="menuitem" href="/cabinet">
            Кошелёк
          </Link>
          <Link role="menuitem" href={`/prodavec/${user.id}`}>
            Мой профиль на витрине
          </Link>
          <Link role="menuitem" href="/cabinet/favorites">
            Избранное
          </Link>
          <Link role="menuitem" href="/cabinet/settings">
            Настройки
          </Link>
          <Link role="menuitem" href="/cabinet/support">
            Поддержка
          </Link>
          {isStaff(user) && (
            <Link role="menuitem" href="/admin">
              Консоль сотрудника
            </Link>
          )}
          <button role="menuitem" type="button" onClick={() => clearSession()}>
            <LogOut size={16} strokeWidth={1.75} aria-hidden /> Выйти
          </button>
        </div>
      )}
    </div>
  );
}
