/* TVShowManiacs service worker — makes the app installable and fast.
   Strategy: app shell (HTML, manifest, icons) is cached and served instantly, updated in the background.
   Poster images are cached as they are seen. API calls are never cached here (the Worker caches those at the edge). */
const VERSION = 'v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open('shell-' + VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // App shell: network first (so deploys show up), fall back to cache when offline
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open('shell-' + VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
    return;
  }
  // Posters: cache first
  if (url.hostname === 'image.tmdb.org') {
    e.respondWith(caches.open('img-' + VERSION).then(async c => { const hit = await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }));
  }
});
