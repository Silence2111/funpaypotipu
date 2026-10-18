'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, LogOut, MessagesSquare } from 'lucide-react';
import { clearSession, getUser, isStaff, type SessionUser } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { useSummary, type Summary } from '@/lib/summary';
import { NotificationsBell } from './notifications-bell';

/** Вошедший пользователь; null — гость. Следит за входом и выходом в других вкладках. */
export function useSessionUser(): SessionUser | null {
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
  return user;
}

export function AuthNav() {
  const user = useSessionUser();
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
 * покупки, которые ждут подтверждения. На телефоне сообщения и профиль —
 * в нижней панели, в шапке остаются поиск и уведомления.
 */
function UserBar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const sum = useSummary(true, pathname);
  const unread = sum?.unreadMessages ?? 0;

  return (
    <div className="row user-bar">
      <Link
        href="/chat"
        className="chip hide-mobile"
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
      <UserMenu user={user} sum={sum} />
    </div>
  );
}

/** Продажи, ждущие выдачи, и покупки, ждущие подтверждения, — счётчик на аватаре. */
export const waitingCount = (sum: Summary | null) => (sum?.sales.toDeliver ?? 0) + (sum?.purchases.toConfirm ?? 0);

/**
 * Пункты профиля — одни и те же в меню шапки и в шторке на телефоне.
 * `extra` — пункты перед «Выйти» (в шторке — тема).
 */
export function ProfileLinks({ user, sum, extra }: { user: SessionUser; sum: Summary | null; extra?: ReactNode }) {
  const toDeliver = sum?.sales.toDeliver ?? 0;
  const toConfirm = sum?.purchases.toConfirm ?? 0;
  return (
    <>
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
      <Link role="menuitem" href="/cabinet/security">
        Безопасность
      </Link>
      <Link role="menuitem" href="/pomosch">
        Помощь
      </Link>
      <Link role="menuitem" href="/cabinet/support">
        Поддержка
      </Link>
      {isStaff(user) && (
        <Link role="menuitem" href="/admin">
          Консоль сотрудника
        </Link>
      )}
      {extra}
      <button role="menuitem" type="button" onClick={() => clearSession()}>
        <LogOut size={16} strokeWidth={1.75} aria-hidden /> Выйти
      </button>
    </>
  );
}

function UserMenu({ user, sum }: { user: SessionUser; sum: Summary | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const waiting = waitingCount(sum);

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

  return (
    <div className="user-menu hide-mobile" ref={box}>
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
        <span className="user-name">{user.username}</span>
        {waiting > 0 && <span className="notif-badge">{waiting}</span>}
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
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
          <ProfileLinks user={user} sum={sum} />
        </div>
      )}
    </div>
  );
}
