/* Fatima Veloxia 2K26 — offline support.
   Saves the app (page, styles, scripts, images) on the device so it opens without internet.
   Score data is never cached here: the page keeps its own copy and syncs it with Supabase. */
importScripts("/js/config.js");
const BUILD = (self.VELOXIA_CONFIG && self.VELOXIA_CONFIG.buildId) || "dev";
const CACHE = "veloxia-" + BUILD;
const APP_SHELL = [
  "/", "/index.html", "/css/styles.css", "/js/config.js", "/js/app.js", "/js/vendor/supabase.js",
  "/assets/logo.png", "/assets/header-bg.jpg", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) =>
    Promise.all(APP_SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})))
  ));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("veloxia-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Supabase data and login always go to the network

  // Pages (including ?display=1): network first so new deploys show up, saved copy when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      Promise.race([fetch(req), timeout(4000)])
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/index.html", copy)); }
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // App files: saved copy first (instant and offline), refreshed in the background.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
