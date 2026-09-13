const CACHE = 'finanzas-pro-v48';
const PRECACHE = [
  '/',
  '/static/app.css?v=28',
  '/static/app.js?v=30',
  '/static/sw.js?v=48',
  '/static/charts.js?v=18',
  '/static/terminal.css?v=38',
  '/static/terminal.js?v=40',
  '/static/forge.js?v=7',
  '/static/forge-layout.js?v=3',
  '/static/offline-queue.js?v=2',
  '/static/home.css?v=15',
  '/static/home.js?v=5',
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
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => res)
        .catch(() => caches.match('/offline').then((r) => r || caches.match('/')))
    );
  }
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'CHECK_PAYMENTS') {
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        list.forEach((c) => c.postMessage({ type: 'CHECK_PAYMENTS' }));
      })
    );
  }
});
