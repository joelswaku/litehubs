/* global self, caches, fetch, URL */

/* LiteHubs application shell. Private workspace pages are intentionally not
 * cached: a shared farm phone must never expose another person's data offline.
 * Static assets are cached so an already-open field form stays usable without
 * a signal. The record queue is handled separately in local device storage. */
// Increment this whenever cache behaviour changes. A new service worker then
// clears stale LiteHubs shell files automatically — users never need to clear
// browser data just to reach the sign-in screen.
const CACHE_NAME = "litehubs-shell-v4";
const SHELL = [
  "/offline",
  "/site.webmanifest",
  "/favicon.ico",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("litehubs-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Next bundles are public program files, not tenant data. Prefer the newest
  // bundle while online and use the cached copy only without a connection.
  // A cache-first strategy here can serve an earlier screen after deployment
  // because Next development and some browser builds reuse chunk URLs.
  if (
    url.pathname.startsWith("/_next/static/") ||
    SHELL.includes(url.pathname)
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // A page navigation with no connection receives a clear, safe fallback. We
  // do not cache authenticated HTML pages or API responses.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")));
  }
});
