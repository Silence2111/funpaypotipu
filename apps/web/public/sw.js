// Сервис-воркер GameMarket. Кэширует одну страницу — «Нет соединения»:
// цены, наличие и статусы заказов должны быть свежими, поэтому остальное
// всегда идёт в сеть. И показывает пуш-уведомления, когда сайт закрыт.
const CACHE = 'gm-offline-v2'; // v2 — страница «Нет соединения» знает английский
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE, { cache: 'reload' }))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

// Пуш от сервера: { title, body, url, tag } (apps/api … push.service.ts).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const url = new URL(data.url || '/', self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Человек уже смотрит этот чат или заказ — второй сигнал ни к чему.
      const watching = windows.some(
        (w) =>
          w.focused && w.visibilityState === 'visible' && new URL(w.url).pathname === url.pathname,
      );
      if (watching) return undefined;
      return self.registration.showNotification(data.title || 'GameMarket', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        lang: 'ru',
        tag: data.tag,
        renotify: Boolean(data.tag),
        data: { url: url.href },
      });
    }),
  );
});

// Нажатие открывает нужную страницу: вкладку сайта, если она есть, иначе новую.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) ||
    new URL('/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const exact = windows.find((w) => w.url === url);
      if (exact) return exact.focus();
      const site = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (site) {
        await site.focus();
        // Вкладка, открытая до установки воркера, по его команде не переходит.
        return site.navigate(url).catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    }),
  );
});
