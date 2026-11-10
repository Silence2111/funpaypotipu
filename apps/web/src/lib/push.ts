'use client';

import { apiFetch, getUser } from './session';

/**
 * Пуш-уведомления на этом устройстве (Web Push). Подписку выдаёт браузер на
 * открытый ключ сервера, сервер шлёт по ней через службу пушей браузера, а
 * показывает уведомление сервис-воркер сайта (public/sw.js).
 */

export type PushHere = 'unsupported' | 'install' | 'denied' | 'off' | 'on';

/** Нужны сервис-воркер, служба пушей и уведомления. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iPhone и iPad принимают пуши только у сайта, установленного на экран «Домой». */
function needsInstall(): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !installed;
}

/** Кто включил пуши в этом браузере: подписка живёт, пока вошёл именно он. */
const OWNER_KEY = 'gm_push_owner';

function owner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function setOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    /* хранилище недоступно — подписка просто не переживёт смену пользователя */
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Что с пушами в этом браузере сейчас. На iPhone вне экрана «Домой» службы
 * пушей нет вовсе — это не «браузер не умеет», а «сначала установите сайт».
 */
export async function pushHere(): Promise<PushHere> {
  if (!pushSupported()) return needsInstall() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && (await currentSubscription())) return 'on';
  return needsInstall() ? 'install' : 'off';
}

const keyBytes = (base64url: string) => {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

const sameKey = (sub: PushSubscription, key: Uint8Array) => {
  const raw = sub.options.applicationServerKey;
  if (!raw) return false;
  const have = new Uint8Array(raw);
  return have.length === key.length && have.every((b, i) => b === key[i]);
};

/**
 * Включить на этом устройстве: разрешение браузера, подписка, подписка — на
 * сервер. Повторный вызов просто напоминает серверу о подписке: тот же
 * браузер у другого пользователя переходит к нему.
 */
export async function enablePush(publicKey: string): Promise<'on' | 'denied'> {
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  // Воркер ставится и в разработке: без него пуш некому показать.
  await navigator.serviceWorker.register('/sw.js');
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Ключ сервера сменили — старая подписка больше не доставит ни одного пуша.
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await apiFetch('/account/push', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
  setOwner(getUser()?.id ?? null);
  return 'on';
}

/** Выключить на этом устройстве: подписка снимается и у сервера, и у браузера. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await apiFetch('/account/push', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined);
  await sub.unsubscribe().catch(() => false);
  setOwner(null);
}

/**
 * Подписка браузера — только тому, кто её включил и сейчас вошёл. Сеанс
 * истёк без «Выйти» или вошёл другой человек — подписка снимается: служба
 * пушей ответит серверу «подписки нет», и он её забудет. Иначе на общем
 * компьютере приходили бы уведомления прежнего пользователя.
 */
export async function keepPushOwner(userId: string | null): Promise<void> {
  if (!pushSupported()) return;
  const sub = await currentSubscription();
  if (sub && userId && owner() === userId) return;
  if (sub) await sub.unsubscribe().catch(() => false);
  setOwner(null);
}
