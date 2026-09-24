"use client";

import { useEffect, useRef } from "react";

import { authClient } from "@/lib/auth-client";
import {
  resetSessionScopedState,
  sessionUserChanged,
} from "@/lib/session/reset-registry";

/**
 * Clears every session-scoped client store when the signed-in account changes
 * (sign-out, sign-in, or a direct switch), so one account's cached data can
 * never be shown — or saved — as another's in the same tab.
 *
 * Mounted once in the root layout: the sign-in/sign-up pages live outside the
 * dashboard layout, so a watcher mounted there would miss the transition.
 */
export function SessionStateReset() {
  const { data, isPending } = authClient.useSession();

  const previousUserId = useRef<string | null | undefined>(undefined);

  // `undefined` while the session is still loading, so a pending session is
  // never mistaken for a sign-out.
  const currentUserId = isPending ? undefined : (data?.user.id ?? null);

  useEffect(() => {
    if (currentUserId === undefined) {
      return;
    }

    if (
      sessionUserChanged({
        previous: previousUserId.current,
        current: currentUserId,
      })
    ) {
      resetSessionScopedState();
    }

    previousUserId.current = currentUserId;
  }, [currentUserId]);

  return null;
}
