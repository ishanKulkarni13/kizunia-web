/**
 * Notifications — Firebase Cloud Messaging Adapter
 *
 * **The only file in this repository that imports `firebase-admin.`**
 *
 * That is the whole point of the port (ND-D-10): everything above this file
 * deals in four outcomes, and swapping FCM for another provider is one new file
 * implementing the same interface. If a Firebase type or error code ever
 * appears outside this directory, the boundary has leaked.
 *
 * The file is deliberately thin. The judgement — which vendor error means what —
 * lives in `fcm-error-mapping.ts`, where it is testable without credentials, a
 * network, or the SDK. What is left here is the shape of the message and the
 * initialisation of the app.
 *
 * ## Server credentials
 *
 * A service account is a server credential and must never reach a browser. It
 * arrives through three server-only environment variables (no `NEXT_PUBLIC_`
 * prefix, which is what keeps it out of the client bundle), read only by the
 * factory, and used only here.
 */
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

import { classifyFcmError, extractFcmErrorCode } from "./fcm-error-mapping";
import type {
  PushMessage,
  PushProvider,
  PushSendResult,
} from "./push-provider.port";
import type { FirebaseServiceAccountConfig } from "./push-provider.factory";

/**
 * Named so this app cannot collide with a default Firebase app another part of
 * the system might initialise later. Re-initialising a named app throws, which
 * is why `getApps()` is checked first — serverless runtimes reuse a process
 * across invocations, so "already initialised" is the normal case, not the
 * exception.
 */
const APP_NAME = "kizunia-notifications";

export class FcmPushProvider implements PushProvider {
  readonly id = "FCM" as const;

  readonly canDeliver = true;

  private readonly app: App;

  constructor(config: FirebaseServiceAccountConfig) {
    const existing = getApps().find((app) => app.name === APP_NAME);

    this.app = existing
      ? getApp(APP_NAME)
      : initializeApp(
          {
            credential: cert({
              projectId: config.projectId,
              clientEmail: config.clientEmail,
              privateKey: config.privateKey,
            }),
          },
          APP_NAME,
        );
  }

  async send(message: PushMessage): Promise<PushSendResult> {
    try {
      const providerMessageId = await getMessaging(this.app).send({
        token: message.token,
        // `webpush` rather than the top-level `notification` field: the top
        // level is the lowest common denominator across platforms, and the
        // things this needs — the click destination, the collapse identity —
        // are web-specific.
        webpush: {
          notification: {
            title: message.title,
            body: message.body,
            // Same identity for every copy of a notification, so a duplicate
            // send caused by at-least-once delivery *replaces* the earlier
            // banner instead of stacking a second one (ND-D-05).
            tag: message.collapseKey,
            renotify: false,
            icon: "/icons/notification-192.png",
          },
          fcmOptions: message.link ? { link: message.link } : undefined,
          headers: {
            // Tells FCM to drop an undelivered message rather than hold it for
            // a device that is offline for days. A notification about a
            // deadline is worthless once the deadline passes, and the inbox
            // already carries it regardless.
            TTL: "86400",
            Topic: message.collapseKey.slice(0, 64),
          },
        },
        data: message.data ? { ...message.data } : undefined,
      });

      return { outcome: "ACCEPTED", providerMessageId };
    } catch (error) {
      // Never rethrow: a rejected message is a classified outcome, not an
      // exception. Throwing would deny the delivery layer the information it
      // needs to decide between retrying, giving up, and deactivating the
      // destination.
      return classifyFcmError(
        extractFcmErrorCode(error),
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
