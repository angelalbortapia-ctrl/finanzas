const CACHE = 'finanzas-pro-v42';
const PRECACHE = [
  '/',
  '/static/app.css?v=28',
  '/static/app.js?v=29',
  '/static/sw.js?v=42',
  '/static/charts.js?v=13',
  '/static/terminal.css?v=38',
  '/static/terminal.js?v=39',
  '/static/terminal-layout.js?v=38',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/offline',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/static/')) {
    e.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        });
        if (cached) {
          network.catch(() => {});
          return cached;
        }
        return network;
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => res)
        .catch(() => caches.match('/offline').then((r) => r || caches.match('/')))
    );
    return;
  }
});
