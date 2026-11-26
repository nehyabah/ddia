// DDIA service worker.
// - /api/*: always the network (progress must be live; never cached).
// - /assets/*: content-hashed build files, cache-first.
// - page navigations: network-first, falling back to the cached app shell when offline.
const CACHE = "ddia-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== "ddia-api-v1").map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// API reads: network first, fall back to the last good copy when offline.
// Never cache auth, AI, push or other per-request endpoints.
const API_CACHE = "ddia-api-v1";
const NO_CACHE = /^\/api\/(auth|ai|push|activity|health|mock\/start|report\/send)/;

self.addEventListener("message", (e) => {
  if (e.data === "clear-api-cache") e.waitUntil(caches.delete(API_CACHE));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Google Fonts: cache-first so the type still looks right offline.
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { c.put(req, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (NO_CACHE.test(url.pathname)) return;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(API_CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.open(API_CACHE).then((c) => c.match(req)).then((hit) => hit ||
          new Response(JSON.stringify({ error: "You are offline and this page has not been opened before." }), { status: 503, headers: { "content-type": "application/json" } }))),
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return res; })
        .catch(() => caches.match("/")),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/art/") || url.pathname.startsWith("/anim/") || /\.(png|svg|webp|webmanifest)$/.test(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }),
    ),
  );
});

// Push reminders
self.addEventListener("push", (e) => {
  let d = { title: "DDIA", body: "Time to study.", url: "/" };
  try { d = { ...d, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
