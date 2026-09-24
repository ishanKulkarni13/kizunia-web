import { describe, expect, it } from "vitest";

import { sanitizeFields, sanitizeValue } from "./sanitize";

describe("sanitizeFields", () => {
  it("redacts a top-level sensitive key", () => {
    expect(sanitizeFields({ password: "hunter2", userId: "u1" })).toEqual({
      password: "[REDACTED]",
      userId: "u1",
    });
  });

  it("redacts common secret/credential key names case-insensitively", () => {
    const input = {
      Token: "a",
      accessToken: "b",
      refreshToken: "c",
      Authorization: "Bearer x",
      cookie: "session=abc",
      apiKey: "key",
      API_KEY: "key2",
      privateKey: "pem",
      clientSecret: "s",
      webhookSecret: "w",
      sessionToken: "st",
    };

    const result = sanitizeFields(input);

    for (const key of Object.keys(input)) {
      expect(result[key]).toBe("[REDACTED]");
    }
  });

  it("leaves ordinary fields untouched", () => {
    expect(sanitizeFields({ notificationId: "n1", count: 3, ok: true })).toEqual({
      notificationId: "n1",
      count: 3,
      ok: true,
    });
  });

  it("recurses into nested objects and redacts sensitive keys at any depth", () => {
    const input = {
      user: { id: "u1", auth: { password: "hunter2" } },
    };

    expect(sanitizeFields(input)).toEqual({
      user: { id: "u1", auth: { password: "[REDACTED]" } },
    });
  });

  it("redacts a container key itself when its name matches, without needing to recurse", () => {
    expect(sanitizeFields({ credentials: { username: "a", password: "b" } })).toEqual({
      credentials: "[REDACTED]",
    });
  });

  it("recurses into arrays", () => {
    const input = { subscriptions: [{ endpoint: "https://push.example/abc" }] };

    expect(sanitizeFields(input)).toEqual({
      subscriptions: [{ endpoint: "[REDACTED]" }],
    });
  });

  it("does not throw on a circular reference and marks it instead", () => {
    const obj: Record<string, unknown> = { name: "x" };
    obj.self = obj;

    expect(() => sanitizeValue(obj)).not.toThrow();
    const result = sanitizeValue(obj) as Record<string, unknown>;
    expect(result.self).toBe("[CIRCULAR]");
  });

  it("converts Date values to ISO strings", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(sanitizeValue({ at: date })).toEqual({ at: "2026-01-01T00:00:00.000Z" });
  });

  it("passes through primitives and null unchanged", () => {
    expect(sanitizeValue("hello")).toBe("hello");
    expect(sanitizeValue(42)).toBe(42);
    expect(sanitizeValue(null)).toBeNull();
    expect(sanitizeValue(undefined)).toBeUndefined();
  });

  it("does not mark a shared (non-circular) reference as [CIRCULAR]", () => {
    const shared = { id: "user-1" };
    const result = sanitizeValue({ a: shared, b: shared }) as Record<string, unknown>;

    // Both properties point to the same object, but neither is a cycle —
    // both must be serialized in full, not replaced with [CIRCULAR].
    expect(result.a).toEqual({ id: "user-1" });
    expect(result.b).toEqual({ id: "user-1" });
  });

  it("still marks an actual cycle as [CIRCULAR]", () => {
    const obj: Record<string, unknown> = { name: "y" };
    obj.self = obj;

    const result = sanitizeValue(obj) as Record<string, unknown>;
    expect(result.self).toBe("[CIRCULAR]");
    expect(result.name).toBe("y");
  });
});
