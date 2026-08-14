/* FGTA Ladder service worker.
 *
 * Goal: make the installed app behave like the website — every time it's
 * opened it shows whatever is currently deployed, not a stale cached copy —
 * while still working offline as a fallback. So navigations are
 * network-first, and the cache only exists as a fallback + an offline shell.
 *
 * Bump VERSION on deploys that change what's precached; it's what forces old
 * caches to be dropped on activate.
 */
const VERSION = "2026-08-14";
const CACHE = `fgta-shell-${VERSION}`;
const SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin (Supabase, fonts, YouTube, API) - not our job

  const isNavigation = req.mode === "navigate" || req.destination === "document";

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match("/index.html")))
    );
    return;
  }

  // Same-origin static assets (icons, manifest): serve from cache instantly,
  // refresh the cache in the background so the next load is current.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
