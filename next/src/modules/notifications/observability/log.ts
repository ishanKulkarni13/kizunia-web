/**
 * Notifications — Structured Logging
 *
 * One line of JSON per event, on `console`. That is the whole thing.
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
 * JSON rather than prose because Vercel's log drain parses it into fields, and
 * `console` rather than a logging library because the repository has no logging
 * abstraction and this does not justify introducing one.
 */

type LogFields = Readonly<Record<string, unknown>>;

/**
 * Events are named `area.thing_that_happened`, in the past tense where
 * something occurred. Stable names matter more than pretty ones — they are what
 * a log query is written against.
 */
export function logNotificationEvent(event: string, fields: LogFields = {}): void {
  // Serialisation is guarded: a field carrying a circular reference — a Prisma
  // error with its client attached, say — must not turn a logging call into
  // the thing that crashes the worker.
  let payload: string;

  try {
    payload = JSON.stringify({ event, ...fields });
  } catch {
    payload = JSON.stringify({
      event,
      logSerializationFailed: true,
      keys: Object.keys(fields),
    });
  }

  console.log(`[notifications] ${payload}`);
}

/** For conditions that need attention rather than merely recording. */
export function logNotificationError(event: string, fields: LogFields = {}): void {
  let payload: string;

  try {
    payload = JSON.stringify({ event, ...fields });
  } catch {
    payload = JSON.stringify({
      event,
      logSerializationFailed: true,
      keys: Object.keys(fields),
    });
  }

  console.error(`[notifications] ${payload}`);
}
