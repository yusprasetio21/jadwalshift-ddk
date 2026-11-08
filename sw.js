const CACHE_NAME = 'shift-ddk-v19';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './polyfills.js',
  './supabase.js',
  './logika.js',
  './manifest.json',
  './manifest-legacy.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Hanya tangani GET request
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Jangan sentuh API eksternal / Supabase / CDN, biarkan langsung via network
  if (url.origin !== self.location.origin) {
    return;
  }

  // 1. Navigation request (misal buka PWA / WebAPK dari layar utama dengan query ?utm_source=webapk)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          // Fallback offline / WebAPK cold start: cari index.html tanpa terpengaruh parameter URL
          return caches.match('./index.html', { ignoreSearch: true })
            .then(res => res || caches.match('./', { ignoreSearch: true }));
        })
    );
    return;
  }

  // 2. Static asset lokal (JS, CSS, Icon, dsb): Cek cache dulu, lalu network
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
