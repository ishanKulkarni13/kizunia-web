import { describe, expect, it } from "vitest";

import { CreateGrantSchema, ExtendGrantSchema, RevokeGrantSchema } from "./grant";

const base = { plan: "PRO", durationDays: 30, reason: "Hackathon prize" } as const;

describe("CreateGrantSchema", () => {
  it("accepts a recipient by user id or by e-mail", () => {
    expect(CreateGrantSchema.safeParse({ ...base, userId: "user_1" }).success).toBe(true);

    const byEmail = CreateGrantSchema.parse({ ...base, email: " Person@Example.com " });
    expect(byEmail.email).toBe("person@example.com");
  });

  it("requires exactly one recipient", () => {
    expect(CreateGrantSchema.safeParse(base).success).toBe(false);
    expect(
      CreateGrantSchema.safeParse({ ...base, userId: "user_1", email: "a@example.com" }).success,
    ).toBe(false);
  });

  it("requires a reason", () => {
    expect(CreateGrantSchema.safeParse({ ...base, userId: "u", reason: "  " }).success).toBe(false);
    expect(CreateGrantSchema.safeParse({ plan: "PRO", durationDays: 1, userId: "u" }).success).toBe(
      false,
    );
  });

  it("only grants paid plans", () => {
    expect(CreateGrantSchema.safeParse({ ...base, userId: "u", plan: "FREE" }).success).toBe(false);
    expect(CreateGrantSchema.safeParse({ ...base, userId: "u", plan: "PRO_PLUS" }).success).toBe(true);
  });

  it("requires an explicit duration: whole days in range, or null for no expiry", () => {
    expect(CreateGrantSchema.safeParse({ ...base, userId: "u", durationDays: null }).success).toBe(true);
    expect(CreateGrantSchema.safeParse({ ...base, userId: "u", durationDays: 0 }).success).toBe(false);
    expect(CreateGrantSchema.safeParse({ ...base, userId: "u", durationDays: 1.5 }).success).toBe(false);
    expect(CreateGrantSchema.safeParse({ ...base, userId: "u", durationDays: 3651 }).success).toBe(false);

    expect(
      CreateGrantSchema.safeParse({ plan: "PRO", reason: "Hackathon prize", userId: "u" }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(CreateGrantSchema.safeParse({ ...base, userId: "u", source: "PROMOTION" }).success).toBe(false);
  });
});

describe("ExtendGrantSchema", () => {
  it("parses an ISO instant into a Date, or keeps null for no expiry", () => {
    const parsed = ExtendGrantSchema.parse({
      validUntil: "2026-12-01T00:00:00.000Z",
      reason: "Extended prize",
    });
    expect(parsed.validUntil).toEqual(new Date("2026-12-01T00:00:00.000Z"));

    expect(ExtendGrantSchema.parse({ validUntil: null, reason: "Team member" }).validUntil).toBeNull();
  });

  it("rejects a missing or malformed end", () => {
    expect(ExtendGrantSchema.safeParse({ reason: "abc" }).success).toBe(false);
    expect(ExtendGrantSchema.safeParse({ validUntil: "next week", reason: "abc" }).success).toBe(false);
  });
});

describe("RevokeGrantSchema", () => {
  it("requires a reason", () => {
    expect(RevokeGrantSchema.safeParse({}).success).toBe(false);
    expect(RevokeGrantSchema.safeParse({ reason: "Abuse report" }).success).toBe(true);
  });
});
