"use client";

import { useCallback, useRef } from "react";

import { ApiError } from "@/lib/http";

/**
 * One `Idempotency-Key` per user click, keyed by what was clicked. A retry of
 * that click after a network failure reuses the key, so the server answers it
 * as the same request; an answer from the server (success or refusal) is
 * final, and the next click gets a new key.
 */
export function useIdempotencyKeys() {
  const keys = useRef(new Map<string, string>());

  const keyFor = useCallback((intent: string) => {
    const existing = keys.current.get(intent);

    if (existing) return existing;

    const created = crypto.randomUUID();

    keys.current.set(intent, created);

    return created;
  }, []);

  /** Call after the request finished: keeps the key only when no answer arrived (a retry must reuse it). */
  const settle = useCallback((intent: string, error?: unknown) => {
    if (error === undefined || error instanceof ApiError) keys.current.delete(intent);
  }, []);

  return { keyFor, settle };
}
