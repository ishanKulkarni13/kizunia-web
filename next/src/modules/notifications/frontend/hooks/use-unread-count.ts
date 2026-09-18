"use client";

import { useEffect, useState } from "react";

import { NotificationApi } from "../../api/notification-api";

/** How often the badge re-checks. */
const DEFAULT_POLL_MS = 60_000;

/**
 * The unread badge's count.
 *
 * Polling rather than anything cleverer: a websocket or SSE connection per
 * signed-in tab is real infrastructure, and the thing being kept fresh is a
 * number next to a bell. A minute of staleness is not a product problem.
 *
 * It backs off when the tab is hidden and re-checks immediately when it becomes
 * visible again — which is both the polite thing to do and, in practice, when
 * the count is most likely to have changed.
 *
 * A failed poll is swallowed. The badge is ambient; surfacing a toast because a
 * background count could not be refreshed would be noise about something the
 * user did not ask for.
 */
export function useUnreadCount(pollMs = DEFAULT_POLL_MS): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function check() {
      if (typeof document !== "undefined" && document.hidden) return;

      try {
        const next = await NotificationApi.unreadCount();
        if (!cancelled) setCount(next);
      } catch {
        // Ambient. Keep the last known value rather than showing zero, which
        // would look like the notifications went away.
      }
    }

    void check();
    timer = setInterval(() => void check(), pollMs);

    const onVisible = () => {
      if (!document.hidden) void check();
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollMs]);

  return count;
}
