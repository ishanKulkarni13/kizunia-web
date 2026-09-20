import { describe, expect, it } from "vitest";

import { classifyFcmError, extractFcmErrorCode } from "./fcm-error-mapping";

describe("classifyFcmError", () => {
  it.each([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-argument",
  ])("treats %s as a dead destination", (code) => {
    expect(classifyFcmError(code).outcome).toBe("INVALID_TOKEN");
  });

  it.each([
    "messaging/authentication-error",
    "messaging/third-party-auth-error",
    "messaging/sender-id-mismatch",
  ])("treats %s as permanent", (code) => {
    // Configuration and credential problems: retrying burns attempts against
    // something only a human can fix.
    expect(classifyFcmError(code).outcome).toBe("PERMANENT");
  });

  it.each([
    "messaging/server-unavailable",
    "messaging/internal-error",
    "messaging/quota-exceeded",
    "messaging/device-message-rate-exceeded",
  ])("treats %s as retryable", (code) => {
    expect(classifyFcmError(code).outcome).toBe("RETRYABLE");
  });

  it("treats an unrecognised code as retryable", () => {
    // The default that matters. FCM's vocabulary changes, and the two ways to
    // be wrong are not symmetric: a permanent error retried wastes a few
    // bounded attempts, a transient one treated as permanent silently drops a
    // notification.
    expect(classifyFcmError("messaging/some-code-invented-next-year").outcome).toBe(
      "RETRYABLE",
    );
  });

  it("treats a missing code as retryable rather than guessing", () => {
    const result = classifyFcmError(undefined);

    expect(result.outcome).toBe("RETRYABLE");
    if (result.outcome === "ACCEPTED") return;
    expect(result.code).toBe("unknown");
  });

  it("normalises case so a differently-cased code is still recognised", () => {
    expect(
      classifyFcmError("MESSAGING/REGISTRATION-TOKEN-NOT-REGISTERED").outcome,
    ).toBe("INVALID_TOKEN");
  });

  it("carries the detail through for diagnosis", () => {
    const result = classifyFcmError("messaging/internal-error", "upstream 500");

    expect(result.outcome).toBe("RETRYABLE");
    if (result.outcome === "ACCEPTED") return;
    expect(result.detail).toBe("upstream 500");
  });
});

describe("extractFcmErrorCode", () => {
  it("reads the SDK's nested errorInfo shape", () => {
    expect(
      extractFcmErrorCode({
        errorInfo: { code: "messaging/registration-token-not-registered" },
      }),
    ).toBe("messaging/registration-token-not-registered");
  });

  it("falls back to a top-level code", () => {
    expect(extractFcmErrorCode({ code: "messaging/internal-error" })).toBe(
      "messaging/internal-error",
    );
  });

  it("prefers errorInfo when both are present", () => {
    expect(
      extractFcmErrorCode({
        code: "app/unknown",
        errorInfo: { code: "messaging/server-unavailable" },
      }),
    ).toBe("messaging/server-unavailable");
  });

  it.each([null, undefined, "a string", 42, {}, { code: 7 }])(
    "returns undefined for %s rather than throwing",
    (value) => {
      // An SDK error is not a contract. A network failure, a wrapped error and
      // a genuine rejection all arrive looking slightly different, and none of
      // them should crash the worker.
      expect(extractFcmErrorCode(value)).toBeUndefined();
    },
  );
});
