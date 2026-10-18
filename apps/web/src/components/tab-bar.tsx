'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { House, LayoutGrid, MessagesSquare, Moon, PlusCircle, Sun, UserRound } from 'lucide-react';
import type { SessionUser } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { useSummary, type Summary } from '@/lib/summary';
import { ProfileLinks, useSessionUser, waitingCount } from './auth-nav';
import { useTheme } from './theme-toggle';

/** Экраны со своей нижней строкой — полем сообщения: панель закрывала бы его. */
const FULLSCREEN = [/^\/chat\/[^/]+/];

const badge = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * Нижняя панель на телефоне, как в приложениях Playerok и Avito: главная,
 * каталог, продать, сообщения и профиль со счётчиками. Профиль открывается
 * шторкой снизу — те же пункты, что в меню шапки на компьютере. Пока
 * открыта клавиатура, панель прячется: она закрывала бы поле ввода.
 */
export function TabBar() {
  const pathname = usePathname();
  const user = useSessionUser();
  const sum = useSummary(!!user, pathname);
  const [sheet, setSheet] = useState(false);

  useEffect(() => setSheet(false), [pathname]);

  // Клавиатура открыта — панель уходит, чтобы не висеть над полем ввода.
  useEffect(() => {
    const typing = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type)));
    const onIn = (e: FocusEvent) => {
      if (typing(e.target)) document.documentElement.dataset.typing = 'true';
    };
    const onOut = () => delete document.documentElement.dataset.typing;
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  if (FULLSCREEN.some((r) => r.test(pathname))) return null;

  const at = (...prefixes: string[]) => prefixes.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));
  const current = (on: boolean) => (on ? ('page' as const) : undefined);
  const unread = sum?.unreadMessages ?? 0;
  const waiting = waitingCount(sum);

  return (
    <>
      <nav className="tabbar" aria-label="Разделы сайта">
        <Link href="/" className="tab-item" aria-current={current(at('/'))}>
          <House size={22} strokeWidth={1.75} aria-hidden />
          <span>Главная</span>
        </Link>
        <Link href="/igry" className="tab-item" aria-current={current(at('/igry', '/igra', '/catalog', '/lot'))}>
          <LayoutGrid size={22} strokeWidth={1.75} aria-hidden />
          <span>Каталог</span>
        </Link>
        <Link href="/cabinet/new" className="tab-item" aria-current={current(at('/cabinet/new'))}>
          <PlusCircle size={22} strokeWidth={1.75} aria-hidden />
          <span>Продать</span>
        </Link>
        <Link
          href={user ? '/chat' : '/login?next=/chat'}
          className="tab-item"
          aria-current={current(at('/chat'))}
          aria-label={unread ? `Сообщения: ${unread} непрочитанных` : undefined}
        >
          <MessagesSquare size={22} strokeWidth={1.75} aria-hidden />
          <span>Сообщения</span>
          {unread > 0 && <span className="notif-badge tab-badge">{badge(unread)}</span>}
        </Link>
        {user ? (
          <button
            type="button"
            className="tab-item"
            aria-haspopup="dialog"
            aria-expanded={sheet}
            data-active={at('/cabinet', '/orders', `/prodavec/${user.id}`) && !at('/cabinet/new') ? 'true' : undefined}
            aria-label={waiting ? `Профиль: ${waiting} ждут действия` : 'Профиль'}
            onClick={() => setSheet(true)}
          >
            <UserRound size={22} strokeWidth={1.75} aria-hidden />
            <span>Профиль</span>
            {waiting > 0 && <span className="notif-badge tab-badge">{badge(waiting)}</span>}
          </button>
        ) : (
          <Link href="/login" className="tab-item" aria-current={current(at('/login', '/register'))}>
            <UserRound size={22} strokeWidth={1.75} aria-hidden />
            <span>Войти</span>
          </Link>
        )}
      </nav>
      {sheet && user && <ProfileSheet user={user} sum={sum} onClose={() => setSheet(false)} />}
    </>
  );
}

/** Шторка профиля: смахнуть вниз, нажать мимо или Esc — закрыть. */
function ProfileSheet({ user, sum, onClose }: { user: SessionUser; sum: Summary | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const onTouchStart = (e: TouchEvent) => {
    // Тянуть можно, только когда шторка не прокручена вниз.
    startY.current = (panel.current?.scrollTop ?? 0) > 0 ? null : e.touches[0]!.clientY;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (startY.current !== null) setDrag(Math.max(0, e.touches[0]!.clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (drag > 80) onClose();
    startY.current = null;
    setDrag(0);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Профиль"
        tabIndex={-1}
        ref={panel}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          // Ссылка на текущую страницу не меняет адрес — закрываем сами.
          if ((e.target as HTMLElement).closest('a')) onClose();
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="sheet-grip" aria-hidden />
        <div className="sheet-head">
          <span className="avatar" style={{ width: 44, height: 44, fontSize: 18 }} aria-hidden>
            {user.username.charAt(0).toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="sheet-name">{user.username}</div>
            {sum && (
              <div className="faint" style={{ fontSize: 14 }}>
                Баланс {formatPrice(sum.balance.available, sum.balance.currency)}
              </div>
            )}
          </div>
        </div>
        <div className="sheet-menu" role="menu" aria-label="Профиль">
          <ProfileLinks
            user={user}
            sum={sum}
            extra={
              <button role="menuitem" type="button" onClick={toggleTheme}>
                {theme === 'dark' ? (
                  <Sun size={16} strokeWidth={1.75} aria-hidden />
                ) : (
                  <Moon size={16} strokeWidth={1.75} aria-hidden />
                )}
                {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}
