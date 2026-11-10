/* Offline cache of the static PWA. No listing pages are stored. */
const CACHE = 'worth-it-test-v2';
const ASSETS = [
  './',
  './index.html',
  './import-help.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './src/config.js',
  './src/score.js',
  './src/parse.js',
  './src/url.js',
  './src/confirm.js',
  './src/bookmarklet.js',
  './src/analytics.js',
  './src/questions.js',
  './src/kb.js',
  './src/validate.js',
  './src/priceSource.js',
  './src/indexAdjust.js',
  './src/importRefPrices.js',
  './src/shareCard.js',
  './src/bestValue.js',
  './data/models.json',
  './data/segments.json',
  './data/garage-kb.json',
  './data/garage-generic-questions.json',
  './data/index.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never cache the extract worker or cross-origin listing lookups.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok && req.url.startsWith(self.location.origin)) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => cached)),
  );
});
