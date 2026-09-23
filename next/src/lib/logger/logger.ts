/**
 * Logger — Core
 *
 * The repository-wide logging entry point. A bare set of functions, not a
 * class instance callers construct or inject — matching how every logging
 * call in this codebase already works today (`logNotificationEvent`,
 * `emitMcpEvent`, `emitRateLimitEvent` are all plain function imports, no
 * DI container, no `new Logger()` anywhere in `src/`).
 *
 * `event` is a stable string, `area.thing_happened`, past tense — the
 * convention `modules/notifications/observability/log.ts` already uses
 * informally. Deliberately not a closed enum: the notifications precedent
 * shows a per-module union doesn't survive contact with more than one
 * module, and a repo-wide one would have to be edited by every feature that
 * ever adds an event, which is exactly the shared-file bottleneck
 * `docs/architecture/folder-structure.md` designs modules to avoid. The
 * module README documents the naming convention instead.
 */

import { getAmbientLogFields } from "./context";
import { normalizeError } from "./error-normalize";
import { sanitizeFields } from "./sanitize";
import { emitRecord } from "./sink";
import type { LogFields, LogLevel } from "./types";

export type { LogFields, LogLevel } from "./types";
export type { LogRecord, LogSink } from "./sink";
export type { NormalizedError } from "./error-normalize";

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  /**
   * `error` is a required, separate parameter (not folded into `fields`) so
   * every error-level call is forced to carry a real cause, and so
   * normalization (stack, `.cause` chain, `AppError` fields) happens exactly
   * once, here, instead of being re-implemented at each call site.
   */
  error(event: string, error: unknown, fields?: LogFields): void;
  /**
   * Returns a logger that merges `bindings` into every subsequent call,
   * without the caller repeating them. Covers the same need the
   * notification handlers currently meet by spreading `{ userId,
   * notificationId, ... }` into every call by hand, and the need MCP meets
   * by threading `requestId` through every `emitMcpEvent` call — with one
   * mechanism instead of two.
   */
  child(bindings: LogFields): Logger;
}

function emit(level: LogLevel, event: string, fields: LogFields): void {
  // Ambient correlation fields (requestId, actorId) are spread last so they
  // are always authoritative — a caller cannot accidentally or intentionally
  // shadow them by passing a field with the same name.
  const merged = { ...fields, ...getAmbientLogFields() };

  emitRecord({
    level,
    event,
    timestamp: new Date().toISOString(),
    fields: sanitizeFields(merged),
  });
}

function createLogger(bindings: LogFields): Logger {
  return {
    info(event, fields) {
      emit("info", event, { ...bindings, ...fields });
    },

    warn(event, fields) {
      emit("warn", event, { ...bindings, ...fields });
    },

    error(event, error, fields) {
      emit("error", event, {
        ...bindings,
        ...fields,
        error: normalizeError(error),
      });
    },

    child(childBindings) {
      return createLogger({ ...bindings, ...childBindings });
    },
  };
}

/** The default, unbound logger. Most call sites use this directly. */
export const logger: Logger = createLogger({});
