"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BillingApi, type BillingSummaryDTO } from "../../api/billing-api";

/** First re-check while finishing up; then a gentle backoff. */
const FIRST_POLL_MS = 2_000;
const MAX_POLL_MS = 10_000;
/** Give up implying progress after this; the due sync and webhooks carry on server-side. */
const MAX_POLL_DURATION_MS = 2 * 60_000;

/**
 * The billing summary, polled while the server says something is in progress
 * ("finishing up" after Checkout, or "confirming" a change) — or while the page
 * asked for it explicitly, right after it started or confirmed a checkout.
 *
 * It polls `/api/v1/me/billing` only, never Razorpay. The server decides when
 * access changes; this just notices sooner. Polling pauses while the tab is
 * hidden and stops after a couple of minutes.
 */
export function useBillingSummary() {
  const [summary, setSummary] = useState<BillingSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [watchUntil, setWatchUntil] = useState<number | null>(null);
  const delay = useRef(FIRST_POLL_MS);

  const refresh = useCallback(async () => {
    try {
      const next = await BillingApi.getSummary();

      setSummary(next);
      setFailed(false);

      return next;
    } catch {
      setFailed(true);

      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /** Starts (or restarts) polling, for example right after Checkout closes. */
  const watch = useCallback(() => {
    delay.current = FIRST_POLL_MS;
    setWatchUntil(Date.now() + MAX_POLL_DURATION_MS);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const busy = summary !== null && (summary.facets.finishingUp || summary.facets.confirming);
  // Asked to watch (after Checkout), or the server reports work in progress on load.
  const polling = watchUntil !== null || busy;

  useEffect(() => {
    if (!polling) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const schedule = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;

        if (Date.now() > (watchUntil ?? startedAt + MAX_POLL_DURATION_MS)) {
          setWatchUntil(null);
          return;
        }

        if (typeof document === "undefined" || !document.hidden) {
          const next = await refresh();

          // Settled: nothing is in progress any more.
          if (next && !next.facets.finishingUp && !next.facets.confirming) {
            setWatchUntil(null);
            return;
          }
        }

        delay.current = Math.min(MAX_POLL_MS, Math.round(delay.current * 1.5));
        if (!cancelled) schedule();
      }, delay.current);
    };

    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [polling, refresh, watchUntil]);

  return { summary, loading, failed, refresh, watch, polling };
}
