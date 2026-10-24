// Minimal app-shell service worker.
// Scope: cache the built static assets so the shell loads when offline.
// This does NOT provide reliable background sync or push while the browser
// is closed -- static GitHub Pages hosting + a service worker cannot
// guarantee that. See README / in-app notice for details.

const CACHE_NAME = 'student-planner-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(['./', './index.html', './manifest.webmanifest']).catch(() => {
        /* best-effort pre-cache; ignore failures (e.g. first deploy) */
      })
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Never intercept cross-origin calls (Gemini, Overpass, OSRM, Open Food Facts, etc.)
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => caches.match('./index.html'))
    )
  );
});
