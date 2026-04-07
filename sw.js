const CACHE = 'tfp-v1';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  self.clients.claim();
});

// No interceptar NADA - solo dejar pasar todo
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Solo cachear archivos del mismo dominio
  if (url.hostname !== self.location.hostname) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
