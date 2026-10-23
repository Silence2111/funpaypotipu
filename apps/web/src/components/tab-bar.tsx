'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { House, LayoutGrid, MessagesSquare, Moon, PlusCircle, Sun, UserRound } from 'lucide-react';
import type { SessionUser } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { useSummary, type Summary } from '@/lib/summary';
import { ProfileLinks, useSessionUser, waitingCount } from './auth-nav';
import { useTheme } from './theme-toggle';
import { BottomSheet } from './bottom-sheet';
import { LangSwitch } from './lang-switch';
import { useT } from '@/lib/i18n/client';

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
  const t = useT();
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
        (el.tagName === 'INPUT' &&
          !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type)));
    // Панель возвращается с задержкой: нажатие на кнопку у нижнего края
    // уводит фокус из поля, и мгновенно вернувшаяся панель оказывалась под
    // пальцем и забирала нажатие — кнопку приходилось жать дважды.
    let back: ReturnType<typeof setTimeout> | undefined;
    const onIn = (e: FocusEvent) => {
      if (!typing(e.target)) return;
      clearTimeout(back);
      document.documentElement.dataset.typing = 'true';
    };
    const onOut = () => {
      clearTimeout(back);
      back = setTimeout(() => {
        if (!typing(document.activeElement)) delete document.documentElement.dataset.typing;
      }, 300);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      clearTimeout(back);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  if (FULLSCREEN.some((r) => r.test(pathname))) return null;

  const at = (...prefixes: string[]) =>
    prefixes.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));
  const current = (on: boolean) => (on ? ('page' as const) : undefined);
  const unread = sum?.unreadMessages ?? 0;
  const waiting = waitingCount(sum);

  return (
    <>
      <nav className="tabbar" aria-label={t('Разделы сайта')}>
        <Link href="/" className="tab-item" aria-current={current(at('/'))}>
          <House size={22} strokeWidth={1.75} aria-hidden />
          <span>{t('Главная')}</span>
        </Link>
        <Link
          href="/igry"
          className="tab-item"
          aria-current={current(at('/igry', '/igra', '/catalog', '/lot'))}
        >
          <LayoutGrid size={22} strokeWidth={1.75} aria-hidden />
          <span>{t('Каталог')}</span>
        </Link>
        <Link href="/cabinet/new" className="tab-item" aria-current={current(at('/cabinet/new'))}>
          <PlusCircle size={22} strokeWidth={1.75} aria-hidden />
          <span>{t('Продать')}</span>
        </Link>
        <Link
          href={user ? '/chat' : '/login?next=/chat'}
          className="tab-item"
          aria-current={current(at('/chat'))}
          aria-label={unread ? t('Сообщения: {n} непрочитанных', { n: unread }) : undefined}
        >
          <MessagesSquare size={22} strokeWidth={1.75} aria-hidden />
          <span>{t('Сообщения')}</span>
          {unread > 0 && <span className="notif-badge tab-badge">{badge(unread)}</span>}
        </Link>
        {user ? (
          <button
            type="button"
            className="tab-item"
            aria-haspopup="dialog"
            aria-expanded={sheet}
            data-active={
              at('/cabinet', '/orders', `/prodavec/${user.id}`) && !at('/cabinet/new')
                ? 'true'
                : undefined
            }
            aria-label={waiting ? t('Профиль: {n} ждут действия', { n: waiting }) : t('Профиль')}
            onClick={() => setSheet(true)}
          >
            <UserRound size={22} strokeWidth={1.75} aria-hidden />
            <span>{t('Профиль')}</span>
            {waiting > 0 && <span className="notif-badge tab-badge">{badge(waiting)}</span>}
          </button>
        ) : (
          <Link
            href="/login"
            className="tab-item"
            aria-current={current(at('/login', '/register'))}
          >
            <UserRound size={22} strokeWidth={1.75} aria-hidden />
            <span>{t('Войти')}</span>
          </Link>
        )}
      </nav>
      {sheet && user && <ProfileSheet user={user} sum={sum} onClose={() => setSheet(false)} />}
    </>
  );
}

/** Шторка профиля: пункты меню шапки, тема и язык. */
function ProfileSheet({
  user,
  sum,
  onClose,
}: {
  user: SessionUser;
  sum: Summary | null;
  onClose: () => void;
}) {
  const t = useT();
  const [theme, toggleTheme] = useTheme();
  return (
    <BottomSheet label={t('Профиль')} onClose={onClose}>
      <div className="sheet-head">
        <span className="avatar" style={{ width: 44, height: 44, fontSize: 18 }} aria-hidden>
          {user.username.charAt(0).toUpperCase()}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="sheet-name">{user.username}</div>
          {sum && (
            <div className="faint" style={{ fontSize: 14 }}>
              {t('Баланс {sum}', {
                sum: formatPrice(sum.balance.available, sum.balance.currency, t),
              })}
            </div>
          )}
        </div>
      </div>
      <div className="sheet-menu" role="menu" aria-label={t('Профиль')}>
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
              {theme === 'dark' ? t('Светлая тема') : t('Тёмная тема')}
            </button>
          }
        />
      </div>
      <div className="sheet-lang">
        <LangSwitch label />
      </div>
    </BottomSheet>
  );
}
