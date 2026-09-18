/**
 * Notifications — FCM Error Classification
 *
 * Pure. Vendor error code in, provider-agnostic outcome out.
 *
 * Separated from the adapter itself so the mapping — which is where the real
 * judgement lives — is testable without `firebase-admin`, a Firebase project,
 * or a network. The adapter around it is then thin enough to be obviously
 * correct.
 *
 * ## The default matters more than the entries
 *
 * An unrecognised code maps to `RETRYABLE`. FCM's error vocabulary changes, and
 * the two ways to be wrong are not symmetric: treating a permanent error as
 * retryable wastes a few bounded attempts, while treating a transient one as
 * permanent silently drops a notification. So the unknown case fails soft, and
 * permanence has to be recognised explicitly.
 */
import type { PushSendResult } from "./push-provider.port";

/**
 * The destination no longer exists, or never did.
 *
 * `registration-token-not-registered` is the common one: the browser cleared
 * its storage, revoked permission, or the token simply aged out.
 *
 * `invalid-argument` is the awkward one — FCM uses it both for a dead token and
 * for a malformed *message*. It is classified as a dead token here because the
 * message shape is fixed by this codebase and does not vary per send: if the
 * payload were malformed, every send would fail rather than one, and the
 * consecutive-failure ceiling would catch that pattern anyway.
 */
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
  "messaging/invalid-recipient",
  "messaging/mismatched-credential",
]);

/**
 * Wrong in a way that will still be wrong later.
 *
 * All of these are configuration or authentication problems. Retrying them
 * burns attempts against a condition only a human can clear — and they are
 * worth distinguishing from a dead token precisely because they mean *every*
 * send is broken, not one destination.
 */
const PERMANENT_CODES = new Set([
  "messaging/authentication-error",
  "messaging/third-party-auth-error",
  "messaging/invalid-apns-credentials",
  "messaging/sender-id-mismatch",
  "app/invalid-credential",
]);

/** Explicitly transient. Listed for documentation; the default covers them too. */
const RETRYABLE_CODES = new Set([
  "messaging/server-unavailable",
  "messaging/internal-error",
  "messaging/unknown-error",
  "messaging/quota-exceeded",
  "messaging/message-rate-exceeded",
  "messaging/device-message-rate-exceeded",
]);

export function classifyFcmError(
  code: string | undefined,
  detail?: string,
): PushSendResult {
  const normalized = (code ?? "unknown").toLowerCase();

  if (INVALID_TOKEN_CODES.has(normalized)) {
    return { outcome: "INVALID_TOKEN", code: normalized, detail };
  }

  if (PERMANENT_CODES.has(normalized)) {
    return { outcome: "PERMANENT", code: normalized, detail };
  }

  if (RETRYABLE_CODES.has(normalized)) {
    return { outcome: "RETRYABLE", code: normalized, detail };
  }

  return { outcome: "RETRYABLE", code: normalized, detail };
}

/**
 * Pulls a code out of whatever `firebase-admin` threw.
 *
 * Defensive about the shape because an SDK error is not a contract: a network
 * failure, a wrapped error, and a genuine messaging rejection all arrive here
 * looking slightly different.
 */
export function extractFcmErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const candidate = error as {
    code?: unknown;
    errorInfo?: { code?: unknown };
  };

  if (typeof candidate.errorInfo?.code === "string") return candidate.errorInfo.code;
  if (typeof candidate.code === "string") return candidate.code;

  return undefined;
}
