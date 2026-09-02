// Service worker minimo: abilita il prompt di installazione automatico su
// Android/Chrome (richiesto dallo spec PWA) e mette in cache l'app shell
// per un caricamento più rapido. Le chiamate a /api/identify NON vengono
// mai messe in cache: richiedono sempre la rete, dato che analizzano foto
// diverse ogni volta.

const CACHE_NAME = "luxscan-shell-v1";
const APP_SHELL = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Mai intercettare le chiamate API: devono sempre andare in rete.
  if (request.url.includes("/api/")) return;

  // Solo richieste GET hanno senso da mettere in cache.
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
