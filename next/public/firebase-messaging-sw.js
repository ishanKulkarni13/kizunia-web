/*
 * Firebase Cloud Messaging service worker.
 *
 * The filename and location are fixed by the FCM web SDK: it must be
 * `firebase-messaging-sw.js` at the origin root. This is why it lives in
 * `public/` as a plain script rather than anywhere Next would bundle it.
 *
 * ## Why the config arrives in the query string
 *
 * Files in `public/` are served verbatim — no build step, no environment
 * substitution — so `process.env` does not exist here and a `NEXT_PUBLIC_`
 * value cannot be inlined. The registration passes the config as search
 * parameters instead (see `src/lib/push/firebase-client.ts`), which keeps one
 * source of truth for it and means this file is identical across deployments.
 *
 * All of it is public client configuration. The service account never comes
 * near the browser.
 *
 * ## What this worker is for
 *
 * Receiving a push while Kizunia is closed. That is the whole point of push —
 * an in-page listener only works when someone already has the site open, which
 * is when they least need telling.
 */

importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js",
);

const params = new URL(self.location).searchParams;

const config = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

// Registered without config — nothing to do. Installing anyway keeps the
// registration valid so a later, correctly-parameterised registration replaces
// it cleanly rather than failing.
if (config.apiKey && config.projectId && config.messagingSenderId) {
  firebase.initializeApp(config);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification ?? {};
    const data = payload.data ?? {};

    // `tag` is the notification's id, set by the server adapter. It is what
    // makes a duplicate push — which at-least-once delivery makes possible —
    // replace the earlier banner instead of stacking a second one.
    const tag = data.notificationId || notification.tag || "kizunia";

    self.registration.showNotification(notification.title ?? "Kizunia", {
      body: notification.body ?? "",
      icon: "/icons/notification-192.png",
      badge: "/icons/notification-badge.png",
      tag,
      renotify: false,
      data: {
        link: payload.fcmOptions?.link || data.link || "/user/notifications",
      },
    });
  });
}

/**
 * Opening a notification.
 *
 * Focuses an existing Kizunia tab where possible rather than opening another
 * one. Someone who already has the site open in a tab does not want a second.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const link = event.notification.data?.link ?? "/user/notifications";
  const target = new URL(link, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === target && "focus" in client) {
            return client.focus();
          }
        }

        for (const client of clientList) {
          if ("navigate" in client && "focus" in client) {
            return client.navigate(target).then((navigated) => navigated?.focus());
          }
        }

        return self.clients.openWindow(target);
      }),
  );
});

// Take over without waiting for every old tab to close, so a corrected
// registration starts working on this visit rather than the next one.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
