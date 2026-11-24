const CACHE_PREFIX = 'so-tu-shell-';
const CACHE = CACHE_PREFIX + '2026-11-24-result-tiles';
const root = new URL(self.registration.scope);
const page = new URL('index.html', root).href;
const script = new URL('sync.js?v=offline-1', root).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([
    new Request(page, { cache: 'reload' }),
    new Request(script, { cache: 'reload' })
  ])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== root.origin) return;
  if (request.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === new URL(page).pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.status < 500) return response;
        return (await caches.match(page, { cacheName: CACHE })) || response;
      } catch {
        return (await caches.match(page, { cacheName: CACHE })) || Response.error();
      }
    })());
  } else if (url.href === script) {
    event.respondWith(caches.match(script, { cacheName: CACHE }).then((cached) => cached || fetch(request)));
  }
});
