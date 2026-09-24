export type LogLevel = "info" | "warn" | "error";

/**
 * Anything a caller wants attached to a log line. Values are sanitized
 * (see `sanitize.ts`) before they ever reach a sink, so callers do not need
 * to pre-redact — passing the value you actually have is the convenient
 * path, and the safe one.
 *
 * Deliberately not narrower than `unknown` values in a flat-ish bag: the
 * three call sites this module replaces (notifications, MCP, rate-limit)
 * all pass whatever shape they have on hand — ids, enums, counts,
 * occasionally a nested object — and a stricter type would force every
 * existing call site to be reshaped for no safety benefit `sanitize.ts`
 * doesn't already provide at the value level.
 */
export type LogFields = Readonly<Record<string, unknown>>;
