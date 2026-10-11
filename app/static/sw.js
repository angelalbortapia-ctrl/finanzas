const CACHE = 'finanzas-pro-v92';
/** Shell offline — terminal/emisora siempre red primero (ver fetch). */
const PRECACHE = [
  '/',
  '/offline',
  '/static/app.css?v=28',
  '/static/app.js?v=33',
  '/static/home.css?v=40',
  '/static/sw.js?v=92',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
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
  const terminalAsset =
    /^\/static\/(terminal|terminal-pro|terminal-financials|terminal-layout|terminal-widgets-layout|emisora|lightweight-charts|home)(\.|-)/.test(
      url.pathname
    );
  if (terminalAsset || url.pathname.endsWith('.js')) {
    e.respondWith(fetch(request));
    return;
  }
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
    e.respondWith(fetch(request).catch(() => caches.match('/offline')));
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
