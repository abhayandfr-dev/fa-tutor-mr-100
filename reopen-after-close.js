// Service Worker for the ACCA Quiz Platform.
// Purpose: once a student has loaded the app at least once while online, cache
// the HTML shell so that reopening the tab, refreshing, or reloading after the
// device goes offline still works — instead of showing the browser's offline
// error page. This does NOT cache Supabase API responses; those still require
// a live connection (auth, saving attempts, past attempts, etc. all degrade
// gracefully in the app itself when offline).
//
// Bump this version string whenever the HTML file changes, so returning
// students get the fresh copy instead of a stale cached one.
const CACHE_VERSION = 'acca-quiz-shell-v1';
// Cache the app's own page plus this file. If your HTML file has a different
// name/path on the server, adjust './' and add it explicitly below.
const SHELL_FILES = [
  './',
  './index.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // addAll fails as a whole if any single URL 404s — try each individually
      // so one missing file doesn't block caching the rest.
      return Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => console.warn('SW: failed to cache', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET navigation/document requests (the HTML shell
  // itself). Everything else — Supabase API calls, fonts, CDN scripts — is
  // left completely alone and goes straight to the network as normal. This
  // keeps the service worker's scope narrow and avoids accidentally caching
  // or interfering with live data requests.
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isDocumentRequest = req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));

  if (!isSameOrigin || !isDocumentRequest) {
    return; // let the browser handle it normally (network, no SW interception)
  }

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        // Got a fresh copy — update the cache for next time we're offline.
        const copy = networkResponse.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        return networkResponse;
      })
      .catch(() =>
        // Network failed (offline) — serve the last cached shell instead of
        // the browser's default offline error page.
        caches.match(req).then((cached) => cached || caches.match('./index.html'))
      )
  );
});

// Lets the page explicitly ask "cache yourself right now" — used by the
// student-facing "Go offline" button so the shell is guaranteed fresh at the
// exact moment they choose to go offline, rather than depending on whichever
// copy happened to be cached from their last regular page load.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRIME_CACHE') {
    event.waitUntil(
      caches.open(CACHE_VERSION).then((cache) =>
        Promise.all(
          SHELL_FILES.map((url) =>
            fetch(url)
              .then((resp) => cache.put(url, resp))
              .catch((err) => console.warn('SW: prime failed for', url, err))
          )
        )
      )
    );
  }
});
