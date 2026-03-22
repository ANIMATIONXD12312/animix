const CACHE = 'animix-v1';
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE)));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));
