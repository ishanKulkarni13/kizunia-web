/**
 * Notifications — Push Provider Selection
 *
 * The one place that decides which provider the delivery layer talks to, and
 * the one place that reads Firebase configuration.
 *
 * ## Why unconfigured falls back rather than failing
 *
 * Most environments this code runs in — local development, CI, a preview
 * deployment, this repository before anyone creates a Firebase project — have
 * no credentials. Making that an error would mean the delivery pipeline could
 * not be exercised at all without a vendor account, and the code path that
 * eventually runs in production would be the one nobody had ever run.
 *
 * So an unconfigured environment gets the fake. It records sends instead of
 * making them, and reports `canDeliver: false`, which the delivery layer turns
 * into a `SKIPPED` delivery with an honest reason. What it never does is record
 * a `SENT` that did not happen.
 *
 * The fallback is logged once at startup, because a production deployment that
 * silently stopped sending pushes would otherwise look exactly like a quiet
 * week.
 */
import { FakePushProvider } from "./fake-push-provider";
import type { PushProvider } from "./push-provider.port";
import { logNotificationEvent } from "../observability/log";

export interface FirebaseServiceAccountConfig {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
}

/**
 * Reads service-account credentials, or reports that they are absent.
 *
 * Three separate variables rather than one JSON blob. The blob form is what
 * Firebase hands you and is tempting for exactly that reason, but it does not
 * survive Vercel's environment UI intact, and a partially-mangled JSON string
 * fails at the first send rather than at deploy time.
 *
 * The private key is stored with escaped newlines — a PEM body cannot survive
 * an environment variable otherwise — and is unescaped here, at the only place
 * that knows the value is a key.
 */
export function readFirebaseConfig(): FirebaseServiceAccountConfig | null {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawPrivateKey) return null;

  const privateKey = rawPrivateKey.replace(/\\n/g, "\n").trim();

  // A key that survived the environment but not intact is worse than one that
  // is absent: absent falls back cleanly, mangled fails at send time with a
  // vendor error nobody will connect to a copy-paste.
  if (!privateKey.includes("BEGIN") || !privateKey.includes("PRIVATE KEY")) {
    logNotificationEvent("push.config_invalid", {
      reason: "FIREBASE_PRIVATE_KEY does not look like a PEM private key",
    });
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

export function isPushConfigured(): boolean {
  return readFirebaseConfig() !== null;
}

let cached: PushProvider | null = null;

/**
 * The provider for this process.
 *
 * Cached because constructing the real one initialises a Firebase app, which is
 * both expensive and unhappy about being done twice in the same process.
 *
 * Async because loading `fcm-push-provider` is a dynamic `import()`, not a
 * `require()`. This module ships as ESM under Next.js's server runtime, and a
 * `require()` of a same-graph ESM module returns the module record itself
 * rather than its named export in that environment — `FcmPushProvider`
 * resolved to something that was not a constructor, so this function threw
 * `TypeError: FcmPushProvider is not a constructor` before
 * `DeliveryService.deliver()` ever ran. Every `DELIVER_NOTIFICATION` job
 * caught that, retried under the job runner's own backoff, and eventually
 * exhausted its attempts — for every intent, with no `WEB_PUSH`
 * `NotificationDelivery` row ever created, because the throw happened before
 * delivery's own code got a chance to create one. `import()` is the
 * interop-safe way to load a module lazily and is what every other lazy load
 * in this codebase already uses.
 */
export async function getPushProvider(): Promise<PushProvider> {
  if (cached) return cached;

  const config = readFirebaseConfig();

  if (!config) {
    logNotificationEvent("push.provider_fallback", {
      provider: "FAKE",
      reason: "Firebase credentials are not configured in this environment",
    });

    cached = new FakePushProvider();
    return cached;
  }

  // Imported lazily so `firebase-admin` is never loaded — or even resolved — in
  // an environment that has no credentials for it. It is a heavy dependency
  // with native-ish initialisation, and the fake path should not pay for it.
  const { FcmPushProvider } = await import("./fcm-push-provider");

  cached = new FcmPushProvider(config);
  return cached;
}

/** For tests, which need a fresh decision per case. */
export function resetPushProviderCache(): void {
  cached = null;
}
