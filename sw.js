const CACHE_NAME = 'ru-study-hub-v2';
const ASSETS = [
  './',
  './index.html',
  './sync.js',
  './manifest.json',
  './Russian_Recitation.html',
  './Russian_WordCloze.html',
  './White_Wine_Guide.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // 仅对同源静态页面做离线缓存优先，云数据库 API 走网络
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const netFetch = fetch(event.request).then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || netFetch;
      })
    );
  }
});
