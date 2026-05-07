const CACHE_NAME = 'walforms-shell-v3';
const ASSETS = [
  '/',
  'index.html',
  'builder.html',
  'form.html',
  'dashboard.html',
  'verify.html',
  'feedback.html',
  'style.css',
  'app.js',
  'builder.js',
  'form.js',
  'dashboard.js',
  'verify.js',
  'fields.js',
  'crypto.js',
  'walrus.js',
  'sui.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const isAppAsset = request.destination === 'script' || request.destination === 'style' || request.destination === 'document';

  if (isAppAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
