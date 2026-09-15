const CACHE_NAME = "salga-shell-v1";
const APP_SHELL = ["/", "/index.html", "/push-ui.js", "/profile-ui.js", "/chat-widget.js", "/chat-ui-enhancements.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/index.html"))));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data?.text?.() || "You have a new SALGA update." }; }
  const title = data.title || "SALGA Digital Mart";
  const options = {
    body: data.body || data.message || "You have a new update.",
    tag: data.tag || (data.orderId ? `salga-order-${data.orderId}` : "salga-update"),
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || "/", orderId: data.orderId || null },
    actions: data.orderId ? [{ action: "open-order", title: "Open order" }] : [{ action: "open", title: "Open SALGA" }]
  };
  event.waitUntil((async () => {
    if (Number.isFinite(Number(data.badgeCount))) {
      try { if (self.registration.setAppBadge) await self.registration.setAppBadge(Number(data.badgeCount)); } catch (_) {}
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if ("focus" in client) {
        client.postMessage({ type: "salga-notification-open", url, orderId: event.notification.data?.orderId || null });
        return client.focus();
      }
    }
    return clients.openWindow(url);
  }));
});
