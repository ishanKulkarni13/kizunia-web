/**
 * Logger — Sanitization
 *
 * Redacts sensitive values out of log fields before they reach a sink. This
 * runs unconditionally inside `logger.*()` — there is no opt-out — because
 * the requirement is that the safe path is the only path, not an
 * opt-in one a caller can forget.
 *
 * ## Why this specific list
 *
 * Not a generic list copied from elsewhere. Each entry traces to a real
 * secret/credential surface found in this codebase:
 *
 *  - `password`                       — Better Auth email/password credentials
 *  - `token`, `accessToken`,
 *    `refreshToken`, `idToken`        — Better Auth / OAuth session and MCP bearer tokens
 *  - `authorization`, `cookie`,
 *    `sessionToken`                   — Better Auth session cookie / header
 *  - `secret`, `clientSecret`,
 *    `webhookSecret`                  — CRON_SECRET, INTERNAL_LIFECYCLE_SECRET,
 *                                        BETTER_AUTH_SECRET, OAuth client secrets
 *  - `apiKey`, `privateKey`           — CLOUDINARY_API_KEY/SECRET, FIREBASE_PRIVATE_KEY,
 *                                        GOOGLE_MAPS_API_KEY
 *  - `pushSubscription`, `endpoint`   — Web Push subscription objects carry a
 *                                        provider endpoint URL that is effectively
 *                                        a bearer credential for sending to that
 *                                        device
 *
 * This is a key-name match, not a value-pattern scanner: it is cheap,
 * predictable, and matches how every one of the sensitive fields above
 * actually arrives at a call site — as a field with a recognizable name.
 * It intentionally does not attempt to scan free-text `message`/body content
 * for secret-shaped substrings; see the module README for why that class of
 * leak (e.g. logging an entire email body) is a call-site misuse the logger
 * flags in documentation rather than something a redaction pass can safely
 * catch without false positives.
 */

const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|authorization|cookie|apikey|api_key|privatekey|private_key|credential|pushsubscription|endpoint/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Recursively redacts sensitive values by key name. Cycle-safe: tracks the
 * current path of ancestor objects (`seen`) so a true circular reference
 * (A → B → A) terminates with `[CIRCULAR]`, while a shared reference (two
 * properties pointing at the same object) is walked in full on each visit —
 * because the object is removed from `seen` once its own subtree is fully
 * processed, a sibling branch correctly re-visits it rather than
 * misclassifying it as circular.
 */
export function sanitizeValue(value: unknown, seen: Set<unknown> = new Set()): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  seen.add(value);

  let result: unknown;

  if (Array.isArray(value)) {
    result = value.map((item) => sanitizeValue(item, seen));
  } else {
    const obj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      obj[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(val, seen);
    }
    result = obj;
  }

  seen.delete(value);

  return result;
}

/** Sanitizes a top-level field bag: redacts sensitive keys, recurses into nested values. */
export function sanitizeFields(
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    result[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(value);
  }

  return result;
}
