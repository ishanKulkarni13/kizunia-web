/**
 * Notifications — Structured Logging
 *
 * A thin, module-scoped wrapper over the shared logger (`lib/logger`).
 *
 * This subsystem has to be able to answer, after the fact: why was no
 * notification created, why was one suppressed, was delivery attempted, how
 * many times, did it fail, is it waiting for a retry, was it a duplicate.
 *
 * Almost all of those are answered by **persisted state** — job rows, delivery
 * rows, attempt rows — which is durable, queryable, and survives log retention.
 * Logs cover the rest: the decisions that deliberately leave no row behind,
 * such as a suppressed evaluation (ND-I-05 makes silence a normal outcome, so
 * it must not look like a malfunction).
 *
 * Every call site in this module continues to use `logNotificationEvent`/
 * `logNotificationError` unchanged, with the exact same event names
 * (`generation.created`, `jobs.failed`, ...) — only the transport moved.
 * Fields are sanitized and errors normalized by `lib/logger`, same as
 * everywhere else in the application now. The `module: "notifications"`
 * field replaces the old `[notifications]` line prefix, so it stays queryable
 * as a field rather than a substring match.
 */

import { logger } from "@/lib/logger";

const notificationsLogger = logger.child({ module: "notifications" });

type LogFields = Readonly<Record<string, unknown>>;

/**
 * Events are named `area.thing_that_happened`, in the past tense where
 * something occurred. Stable names matter more than pretty ones — they are what
 * a log query is written against.
 */
export function logNotificationEvent(event: string, fields: LogFields = {}): void {
  notificationsLogger.info(event, fields);
}

/**
 * For conditions that need attention rather than merely recording. `fields`
 * may carry an `error` key — if present, it is used as the underlying cause
 * `lib/logger` normalizes; otherwise the event name itself is the only
 * diagnostic available, which is still recorded correctly.
 */
export function logNotificationError(event: string, fields: LogFields = {}): void {
  const { error, ...rest } = fields as LogFields & { error?: unknown };

  notificationsLogger.error(event, error, rest);
}
