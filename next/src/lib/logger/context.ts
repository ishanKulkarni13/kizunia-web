/**
 * Logger — Request Context
 *
 * Propagates a `requestId` (and, when already known, an `actorId`) to every
 * `logger.*()` call made anywhere during one request, without an
 * application-code caller having to thread it through a service/repository
 * call chain by hand.
 *
 * Uses `AsyncLocalStorage`, on the same validated basis
 * `lib/rate-limit/response-context.ts` already established for this
 * repository: every route handler runs on the default Node.js serverless
 * runtime (no `export const runtime = "edge"` appears anywhere in `src/`),
 * and the app already depends on Prisma + Better Auth, neither
 * edge-compatible — so `node:async_hooks` is available and reliable here.
 * This module does not re-argue that; it reuses the same conclusion.
 *
 * ## What this module deliberately does NOT do
 *
 * It never resolves an actor itself. It has no dependency on
 * `SessionService`, `PlatformAuthorizer`, or any authentication/authorization
 * code, and must never grow one — the logger is infrastructure, not a
 * second place request identity gets decided. `actorId` is set only via
 * {@link setLogActorId}, called by request-handling code (e.g. `Route.execute`
 * or a controller) *after* it has already resolved the actor for its own
 * purposes (authorization, business logic). This avoids a duplicate lookup
 * and keeps the logger from ever being in a position to make an auth
 * decision, or to run before one has been made.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface LogContextState {
  requestId: string;
  actorId?: string;
}

const storage = new AsyncLocalStorage<LogContextState>();

/**
 * Establishes a request-scoped log context for the duration of `fn`. Called
 * once per request, at the same outer boundary that already establishes the
 * rate-limit response context (`Route.execute`) or, for internal/cron
 * routes that bypass `Route.execute`, at their own entry point.
 */
export function runWithLogContext<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ requestId }, fn);
}

/**
 * Records the actor id for the request currently in flight, once the caller
 * has already resolved one for its own purposes. A no-op outside an active
 * {@link runWithLogContext} call (e.g. a script, a test that logs without
 * establishing context) — logging must never throw because context wasn't
 * set up.
 */
export function setLogActorId(actorId: string | null | undefined): void {
  const state = storage.getStore();

  if (state && actorId) {
    state.actorId = actorId;
  }
}

/** Reads the current request id, if any. */
export function getLogRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Reads the current actor id, if one has been recorded. */
export function getLogActorId(): string | undefined {
  return storage.getStore()?.actorId;
}

/** The ambient fields every `logger.*()` call merges in automatically. */
export function getAmbientLogFields(): Readonly<Record<string, unknown>> {
  const state = storage.getStore();

  if (!state) {
    return {};
  }

  const fields: Record<string, unknown> = { requestId: state.requestId };

  if (state.actorId) {
    fields.actorId = state.actorId;
  }

  return fields;
}
