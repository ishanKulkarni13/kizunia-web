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
      // Both survive to `notificationclick`, which is the only place they are
      // needed. `notificationId` is the authoritative identity — the click must
      // never re-derive it from the link, title or anything else. `link` is
      // null when the notification carries no action of its own, so the click
      // can tell "opened its action" from "fell back to the inbox".
      data: {
        notificationId: data.notificationId || null,
        link: payload.fcmOptions?.link || data.link || null,
      },
    });
  });
}

const INBOX_PATH = "/user/notifications";
const NOTIFICATIONS_API = "/api/v1/me/notifications";
const ACK_TIMEOUT_MS = 8000;

// Notification ids are opaque cuids. A conservative shape check rather than a
// cuid-specific one: it only has to keep a malformed value out of a URL path.
const NOTIFICATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Tells the server this notification was acted on.
 *
 * Uses the existing inbox endpoints, authenticated by the session cookie a
 * same-origin fetch carries. No user id is sent and none is trusted: the server
 * derives the actor from the session and scopes the update to that user, so
 * this can only ever touch the signed-in user's own notification.
 *
 * - has an action  -> `responded` (which also marks it read, as in the inbox)
 * - inbox fallback -> `read` (nothing was opened, so nothing was responded to)
 *
 * Best effort by design. It never throws and its outcome is never inspected:
 * an expired session, an offline click or a server error leaves the
 * notification unread in the inbox, which reconciles on the next visit.
 * Both endpoints are idempotent, so a duplicate click is harmless.
 */
function acknowledge(notificationId, hasAction) {
  if (typeof notificationId !== "string") return Promise.resolve();
  if (!NOTIFICATION_ID_PATTERN.test(notificationId)) return Promise.resolve();

  const kind = hasAction ? "responded" : "read";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACK_TIMEOUT_MS);

  try {
    return fetch(
      `${NOTIFICATIONS_API}/${encodeURIComponent(notificationId)}/${kind}`,
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      },
    )
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
  } catch {
    clearTimeout(timer);
    return Promise.resolve();
  }
}

/**
 * Where a click goes.
 *
 * Same-origin only. The server already guarantees this for push links; the
 * check is here so the worker does not depend on it to keep a click inside
 * Kizunia.
 */
function resolveTarget(link) {
  const fallback = new URL(INBOX_PATH, self.location.origin).href;

  if (!link) return fallback;

  try {
    const url = new URL(link, self.location.origin);
    return url.origin === self.location.origin ? url.href : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Focuses an existing Kizunia tab where possible rather than opening another
 * one. Someone who already has the site open in a tab does not want a second.
 */
function openTarget(target) {
  return self.clients
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
    });
}

/**
 * Opening a notification.
 *
 * Two independent jobs: acknowledge the notification, and take the user to its
 * target. They start together and neither waits for the other, so a failed or
 * slow acknowledgement can never strand someone on a banner. Nothing here knows
 * what kind of notification it is — the id and the link are all it needs.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data ?? {};

  event.waitUntil(
    Promise.allSettled([
      acknowledge(data.notificationId, Boolean(data.link)),
      openTarget(resolveTarget(data.link)),
    ]),
  );
});

// Take over without waiting for every old tab to close, so a corrected
// registration starts working on this visit rather than the next one.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
