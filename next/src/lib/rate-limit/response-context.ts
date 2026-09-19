/**
 * Propagates a successful rate-limit decision from wherever it was made
 * (inside a controller, deep in `RateLimitService.check`) out to
 * `Route.execute`, so the outer HTTP layer can attach `RateLimit-*` headers
 * to a 200 response without every controller doing it by hand.
 *
 * Uses `AsyncLocalStorage`, validated against this project's actual
 * runtime: every route handler in this repo runs on the default Node.js
 * serverless runtime (no `export const runtime = "edge"` appears anywhere
 * in `src/`, and the app already depends on Prisma + Better Auth, neither
 * edge-compatible), so `node:async_hooks` is available and reliable here.
 *
 * The 429 path does NOT use this — `ErrorHandler` reads the headers
 * straight off the thrown `RateLimitError`, which is simpler and does not
 * depend on the store surviving until the catch block runs.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { RateLimitDecision } from "./service";

interface RateLimitContextState {
  decision?: RateLimitDecision;
}

const storage = new AsyncLocalStorage<RateLimitContextState>();

/** Wraps a request handler so decisions recorded inside it can be read back afterward. Called once, by `Route.execute`. */
export function runWithRateLimitContext<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({}, fn);
}

/** Records the decision for the request currently in flight. Called by `RateLimitService`. */
export function recordRateLimitDecision(decision: RateLimitDecision): void {
  const state = storage.getStore();

  if (state) {
    state.decision = decision;
  }
}

/** Reads back the most recent decision recorded during this request, if any. Called by `Route.execute` after the handler resolves. */
export function getRateLimitDecision(): RateLimitDecision | undefined {
  return storage.getStore()?.decision;
}
