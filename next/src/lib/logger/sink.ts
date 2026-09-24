/**
 * Logger — Sink
 *
 * The one place this module touches `console`. Everything else in
 * `lib/logger` produces a fully-formed {@link LogRecord} and hands it here.
 *
 * ## Why a sink, and why this shape
 *
 * This is the provider-independence boundary. Application code never touches
 * `console` and never will touch whatever replaces it — it calls
 * `logger.info`/`.warn`/`.error`, which always produce a `LogRecord` and pass
 * it to whatever sink is currently installed. Introducing a hosted log
 * platform, an error-monitoring service, or any other destination later is
 * exactly one `setLogSink(...)` call at application startup — nothing under
 * `lib/logger` or any of its callers changes.
 *
 * `LogRecord` is deliberately the same shape a third-party structured-logging
 * ingest expects: a level, an ISO timestamp, a stable event name, and a flat
 * sanitized field bag with error details folded in when present. A future
 * sink adapter (e.g. shipping to a hosted provider's SDK) consumes this
 * directly — it does not need `lib/logger` to change shape to accommodate it.
 * A sink is a plain function, not a class/interface hierarchy: the only
 * operation a destination ever needs is "accept one record," so that is the
 * entire contract. Multiple destinations (e.g. console AND a future
 * provider) compose by installing a sink that fans out to both — no change
 * to this file is needed to support that either.
 *
 * `LogSink` may return `void` or `Promise<void>`. Most hosted
 * logging/observability SDKs batch and flush asynchronously, so a sink that
 * ships to one legitimately needs to `await` a network call. Callers of
 * `logger.*()` never await the result either way — logging stays
 * fire-and-forget from the application's perspective, matching every
 * existing call site in this codebase, none of which currently awaits a log
 * call. `emitRecord` (below) explicitly does not await an async sink's
 * returned promise for the same reason; a slow or failing sink must never
 * make an application code path slower or less reliable than logging
 * nothing at all. This is a serverless-specific tradeoff worth being
 * explicit about: on a platform that suspends the function once the
 * response is sent, a genuinely async sink can lose a record that hasn't
 * flushed yet. A provider that needs a delivery guarantee stronger than
 * "best effort" supplies its own flush hook (e.g. wired into the request
 * handler via the platform's own `waitUntil`) — that is an infrastructure
 * detail of the sink adapter, not something `lib/logger`'s call sites need
 * to know about or change for.
 *
 * This mirrors the sink-swap mechanism already proven in
 * `lib/rate-limit/events.ts` and `modules/mcp/observability/events.ts`,
 * generalized to the whole application instead of one module each.
 */

import type { LogLevel } from "./types";

export interface LogRecord {
  readonly level: LogLevel;
  readonly event: string;
  readonly timestamp: string;
  /** Already sanitized, already flattened — safe to serialize as-is. */
  readonly fields: Readonly<Record<string, unknown>>;
}

export type LogSink = (record: LogRecord) => void | Promise<void>;

const consoleMethodForLevel: Record<LogLevel, "log" | "warn" | "error"> = {
  info: "log",
  warn: "warn",
  error: "error",
};

/**
 * Structured JSON, one line per record, on `console` — parseable by Vercel's
 * log drain into fields today, and by any future provider's stdout-scraping
 * ingest without change. Serialization is guarded: a field that cannot be
 * `JSON.stringify`d (a circular reference — a Prisma error carrying its
 * client is the concrete case seen in this codebase) must never turn a
 * logging call into the thing that crashes the caller.
 */
export const consoleSink: LogSink = (record) => {
  const method = consoleMethodForLevel[record.level];

  try {
    console[method](JSON.stringify(record));
  } catch {
    console[method](
      JSON.stringify({
        level: record.level,
        event: record.event,
        timestamp: record.timestamp,
        logSerializationFailed: true,
        fieldKeys: Object.keys(record.fields),
      }),
    );
  }
};

let sink: LogSink = consoleSink;

/**
 * Installs a different destination for every subsequent log call.
 *
 * This is the seam a future third-party logging/observability provider
 * attaches through: write one adapter function matching {@link LogSink},
 * call this once during application startup (or in a test), and every
 * existing `logger.*()` call site is unaffected.
 */
export function setLogSink(next: LogSink): void {
  sink = next;
}

/** Restores the default console sink. Mainly for tests to clean up after themselves. */
export function resetLogSink(): void {
  sink = consoleSink;
}

/** Not exported from the package barrel — internal to `lib/logger` only. */
export function emitRecord(record: LogRecord): void {
  try {
    const result = sink(record);

    // A sink is allowed to be async (see `LogSink`'s doc-comment), but a
    // logging call is never awaited by its caller — so a rejection has to be
    // caught here instead of propagating as an unhandled rejection.
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => {
        try {
          consoleSink(record);
        } catch {
          // Truly nothing left to do.
        }
      });
    }
  } catch {
    // A misbehaving sink must never fail the caller's actual operation.
    // Falling back to the console sink keeps the record from being lost
    // silently.
    try {
      consoleSink(record);
    } catch {
      // Truly nothing left to do — swallow rather than throw from a logging call.
    }
  }
}
