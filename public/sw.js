/* Fatima Veloxia 2K26 — offline support.
   Saves the app (page, styles, scripts, images) on the device so it opens instantly, with or without internet.
   Each deploy gets its own saved copy: a new version downloads in the background for the next page load.
   Score data is never cached here: the page keeps its own copy and syncs it with Supabase. */
importScripts("/js/config.js");
const BUILD = (self.VELOXIA_CONFIG && self.VELOXIA_CONFIG.buildId) || "dev";
const CACHE = "veloxia-" + BUILD;
const CORE = ["/index.html", "/css/styles.css", "/js/config.js", "/js/app.js", "/js/vendor/supabase.js"];
const OPTIONAL = [
  "/",
  "/assets/logo.png", "/assets/header-bg.jpg", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Keep the previous worker if any file needed to open offline cannot be cached.
    await cache.addAll(CORE.map((url) => new Request(url, { cache: "reload" })));
    await Promise.all(OPTIONAL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("veloxia-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Supabase data and login always go to the network

  // Offline-first: the saved copy of this build answers straight away, so a weak signal never slows the page.
  // Saved files are only replaced by the next build's worker, so the page and its scripts always match.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req.mode === "navigate" ? "/index.html" : req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && req.mode !== "navigate") await cache.put(req, res.clone());
    return res;
  })());
});
