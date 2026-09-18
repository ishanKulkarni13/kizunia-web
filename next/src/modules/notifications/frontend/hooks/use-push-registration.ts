"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/http";
import {
  getPermissionState,
  getPushSupportState,
  requestPushToken,
  type PushSupportState,
} from "@/lib/push/firebase-client";

import { PushSubscriptionApi } from "../../api/notification-api";
import type { PushSubscriptionDTO } from "../../types/notification.dto";

export type PushStatus =
  /** Still working out what the browser can do. */
  | "checking"
  /** This browser cannot do push at all, for a stated reason. */
  | "unsupported"
  /** Available, and the user has not been asked. */
  | "available"
  /** The user said no. */
  | "denied"
  /** Registered and receiving. */
  | "enabled"
  /** A request is in flight. */
  | "working";

export interface UsePushRegistration {
  readonly status: PushStatus;
  readonly reason: PushSupportState | null;
  readonly subscriptions: readonly PushSubscriptionDTO[];
  readonly error: string | null;
  readonly enable: () => Promise<void>;
  readonly revoke: (subscriptionId: string) => Promise<void>;
}

/**
 * Enabling and listing this browser's push registration.
 *
 * ## On not nagging
 *
 * The permission prompt is asked **once, on an explicit click**, and never
 * again automatically. A denied permission is a final answer as far as this
 * hook is concerned: browsers punish sites that re-prompt, several stop showing
 * the dialog entirely, and a user who said no and is asked again every visit
 * has been told their answer did not count.
 *
 * When the state is `denied`, the UI explains how to undo it in browser
 * settings rather than offering a button that cannot work.
 */
export function usePushRegistration(): UsePushRegistration {
  const [status, setStatus] = useState<PushStatus>("checking");
  const [reason, setReason] = useState<PushSupportState | null>(null);
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const support = getPushSupportState();

      if (support !== "supported") {
        if (!cancelled) {
          setStatus("unsupported");
          setReason(support);
        }
        return;
      }

      const permission = getPermissionState();

      try {
        const existing = await PushSubscriptionApi.list();
        if (cancelled) return;

        setSubscriptions(existing);

        // "Granted" alone is not the same as registered: permission is
        // per-origin and survives a cleared token, so the server's view is what
        // decides whether this account is actually reachable.
        setStatus(
          permission === "denied"
            ? "denied"
            : permission === "granted" && existing.length > 0
              ? "enabled"
              : "available",
        );
      } catch {
        if (!cancelled) setStatus(permission === "denied" ? "denied" : "available");
      }
    }

    void check();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setStatus("working");
    setError(null);

    const result = await requestPushToken();

    if (result.status === "denied") {
      setStatus("denied");
      return;
    }

    if (result.status === "unsupported") {
      setStatus("unsupported");
      setReason(result.reason);
      return;
    }

    if (result.status === "failed") {
      setStatus("available");
      setError(result.message);
      return;
    }

    try {
      const subscription = await PushSubscriptionApi.register(
        result.token,
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      );

      setSubscriptions((previous) => {
        const withoutSelf = previous.filter((item) => item.id !== subscription.id);
        return [subscription, ...withoutSelf];
      });
      setStatus("enabled");
    } catch (caught) {
      setStatus("available");
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not register this browser for notifications.",
      );
    }
  }, []);

  const revoke = useCallback(async (subscriptionId: string) => {
    const snapshot = subscriptions;
    setSubscriptions((previous) =>
      previous.filter((item) => item.id !== subscriptionId),
    );

    try {
      await PushSubscriptionApi.revoke(subscriptionId);
      setStatus((current) => (current === "enabled" ? "available" : current));
    } catch (caught) {
      setSubscriptions(snapshot);
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not turn off notifications for that device.",
      );
    }
  }, [subscriptions]);

  return { status, reason, subscriptions, error, enable, revoke };
}
