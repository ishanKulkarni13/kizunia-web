/**
 * Browser-side Firebase Messaging.
 *
 * The client counterpart of the server's FCM adapter, and the only file in the
 * browser bundle that imports the Firebase SDK. Everything it needs is public
 * config (`NEXT_PUBLIC_*`) — the service account never comes near this side.
 *
 * ## Everything here can fail, and none of it is exceptional
 *
 * Push is the least reliable capability the browser offers. It is absent in
 * private windows, absent without a service worker, absent on iOS unless the
 * site is installed to the home screen, absent when a corporate policy blocks
 * it, and absent when the user simply says no. Each of those is a normal
 * outcome, not an error.
 *
 * So every function here reports a *reason* rather than throwing, and the UI
 * can say something true about why push is unavailable instead of showing a
 * button that does nothing.
 */

export type PushSupportState =
  | "supported"
  | "no-window"
  | "no-service-worker"
  | "no-notification-api"
  | "not-configured";

export interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly messagingSenderId: string;
  readonly appId: string;
  readonly vapidKey: string;
}

/**
 * Reads the public config, or reports that it is absent.
 *
 * Absent is the expected state in local development and in this repository
 * until someone creates a Firebase project, so it must degrade to "push is
 * unavailable" rather than to a crash on first render.
 */
export function readFirebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

  if (
    !apiKey ||
    !authDomain ||
    !projectId ||
    !messagingSenderId ||
    !appId ||
    !vapidKey
  ) {
    return null;
  }

  return { apiKey, authDomain, projectId, messagingSenderId, appId, vapidKey };
}

/**
 * The service worker URL, carrying the Firebase config as search parameters.
 *
 * Files in `public/` are served verbatim, with no build step and no environment
 * substitution, so the worker cannot read `NEXT_PUBLIC_*` values itself.
 * Passing them at registration keeps one source of truth for the config and
 * leaves the worker file identical across every deployment.
 *
 * The VAPID key is deliberately **not** included: the worker has no use for it,
 * and a value that appears in a URL turns up in server logs and browser
 * history. It is passed directly to `getToken` instead.
 */
function serviceWorkerUrl(config: FirebaseWebConfig): string {
  const params = new URLSearchParams({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });

  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export function getPushSupportState(): PushSupportState {
  if (typeof window === "undefined") return "no-window";
  if (!("serviceWorker" in navigator)) return "no-service-worker";
  if (!("Notification" in window)) return "no-notification-api";
  if (!readFirebaseWebConfig()) return "not-configured";

  return "supported";
}

export function getPermissionState(): NotificationPermission | "unavailable" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unavailable";
  }

  return Notification.permission;
}

export type TokenRequestResult =
  | { readonly status: "ok"; readonly token: string }
  | { readonly status: "denied" }
  | { readonly status: "unsupported"; readonly reason: PushSupportState }
  | { readonly status: "failed"; readonly message: string };

/**
 * Asks permission if needed, registers the service worker, and returns a token.
 *
 * Registration is explicit rather than relying on the SDK's default lookup: the
 * service worker has to be the one at the origin root under its required
 * filename, and passing it in makes that a stated fact rather than a convention
 * that silently stops holding.
 *
 * The SDK is imported dynamically so it is not in the initial bundle. Most
 * visitors never enable push, and a messaging SDK is not a small thing to make
 * them download on the way to a competition page.
 */
export async function requestPushToken(): Promise<TokenRequestResult> {
  const support = getPushSupportState();
  if (support !== "supported") {
    return { status: "unsupported", reason: support };
  }

  const config = readFirebaseWebConfig();
  if (!config) return { status: "unsupported", reason: "not-configured" };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { status: "denied" };

    const [{ initializeApp, getApps, getApp }, { getMessaging, getToken, isSupported }] =
      await Promise.all([import("firebase/app"), import("firebase/messaging")]);

    // The SDK's own capability check. It catches browsers that have the APIs
    // but cannot actually deliver — older Safari being the usual example.
    if (!(await isSupported())) {
      return { status: "unsupported", reason: "no-notification-api" };
    }

    const app = getApps().length ? getApp() : initializeApp(config);

    const registration = await navigator.serviceWorker.register(
      serviceWorkerUrl(config),
      { scope: "/" },
    );

    const token = await getToken(getMessaging(app), {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      return {
        status: "failed",
        message: "The browser did not return a push token.",
      };
    }

    return { status: "ok", token };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Handles a push that arrives while the page is open.
 *
 * The service worker only shows a notification when the page is *not* focused;
 * a banner over the page someone is already looking at is an interruption
 * rather than a notification. This hook is where the app can react in-page
 * instead — refreshing the unread badge, for example.
 *
 * Returns an unsubscribe function, or null if messaging is unavailable.
 */
export async function onForegroundMessage(
  handler: (payload: unknown) => void,
): Promise<(() => void) | null> {
  if (getPushSupportState() !== "supported") return null;

  const config = readFirebaseWebConfig();
  if (!config) return null;

  try {
    const [{ initializeApp, getApps, getApp }, { getMessaging, onMessage, isSupported }] =
      await Promise.all([import("firebase/app"), import("firebase/messaging")]);

    if (!(await isSupported())) return null;

    const app = getApps().length ? getApp() : initializeApp(config);

    return onMessage(getMessaging(app), handler);
  } catch {
    return null;
  }
}
