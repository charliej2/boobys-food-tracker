// Service worker: caches the static app shell so Trakd loads offline and
// installs as a PWA. Deliberately does NOT cache USDA FoodData Central API
// responses — nutrition search results should always come from the live
// API, never a stale cached copy. Bump CACHE_NAME whenever app shell files
// change so old caches are cleared out on the next visit.
const CACHE_NAME = "trakd-shell-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./data.js",
  "./config.js",
  "./api.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept USDA API calls (or any other cross-origin request) —
  // those need to stay live. Only manage caching for same-origin app files.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
