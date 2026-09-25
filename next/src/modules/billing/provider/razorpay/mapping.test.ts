import { describe, expect, it } from "vitest";

import { mapPaymentEntity, mapSubscriptionCollection, mapSubscriptionEntity } from "./mapping";

/** The shape of a fetched subscription, as observed against TEST. */
function entity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub_ABC123",
    entity: "subscription",
    plan_id: "plan_XYZ789",
    customer_id: null,
    status: "active",
    current_start: 1_790_000_000,
    current_end: 1_792_592_000,
    ended_at: null,
    quantity: 1,
    notes: { kz_sub: "ksub_1", kz_op: "kop_1", kz_env: "TEST" },
    charge_at: 1_792_592_000,
    start_at: 1_790_000_000,
    end_at: 1_900_000_000,
    auth_attempts: 0,
    total_count: 600,
    paid_count: 1,
    customer_notify: true,
    created_at: 1_789_999_000,
    expire_by: 1_790_100_000,
    short_url: "https://rzp.io/i/abc",
    has_scheduled_changes: false,
    change_scheduled_at: null,
    source: "api",
    remaining_count: 599,
    payment_method: "card",
    halted_at: null,
    ...overrides,
  };
}

function mapped(overrides: Record<string, unknown> = {}) {
  const result = mapSubscriptionEntity(entity(overrides));

  if (!result.ok) throw new Error(`expected a mapped entity, got: ${result.reason}`);

  return result.value;
}

function reasonFor(body: unknown): string {
  const result = mapSubscriptionEntity(body);

  if (result.ok) throw new Error("expected the entity to be malformed");

  return result.reason;
}

describe("mapSubscriptionEntity", () => {
  it("translates the fields Kizunia needs", () => {
    expect(mapped()).toEqual({
      providerSubscriptionId: "sub_ABC123",
      rawStatus: "active",
      providerPlanId: "plan_XYZ789",
      currentStart: new Date(1_790_000_000_000),
      currentEnd: new Date(1_792_592_000_000),
      chargeAt: new Date(1_792_592_000_000),
      startAt: new Date(1_790_000_000_000),
      endAt: new Date(1_900_000_000_000),
      endedAt: null,
      expireBy: new Date(1_790_100_000_000),
      hasScheduledChanges: false,
      changeScheduledAt: null,
      offerId: null,
      notes: { kz_sub: "ksub_1", kz_op: "kop_1", kz_env: "TEST" },
      paidCount: 1,
      shortUrl: "https://rzp.io/i/abc",
      paymentMethod: "card",
      haltedAt: null,
    });
  });

  it("converts epoch seconds to Dates exactly", () => {
    expect(mapped({ current_end: 1 }).currentEnd?.toISOString()).toBe("1970-01-01T00:00:01.000Z");
  });

  it("reads absent and null optional fields as null", () => {
    const state = mapped({
      current_start: null,
      current_end: undefined,
      charge_at: null,
      start_at: undefined,
      end_at: null,
      expire_by: null,
      offer_id: undefined,
      paid_count: null,
      short_url: undefined,
    });

    expect(state).toMatchObject({
      currentStart: null,
      currentEnd: null,
      chargeAt: null,
      startAt: null,
      endAt: null,
      expireBy: null,
      offerId: null,
      paidCount: null,
      shortUrl: null,
    });
  });

  it("reads an absent has_scheduled_changes as false", () => {
    expect(mapped({ has_scheduled_changes: undefined }).hasScheduledChanges).toBe(false);
    expect(mapped({ has_scheduled_changes: true }).hasScheduledChanges).toBe(true);
  });
});

describe("mapSubscriptionEntity — the provider status is passed through, never mapped", () => {
  const statuses = [
    "created",
    "authenticated",
    "active",
    "pending",
    "halted",
    "paused",
    "cancelled",
    "completed",
    "expired",
  ];

  it.each(statuses)("carries %s through as rawStatus, unchanged", (status) => {
    expect(mapped({ status }).rawStatus).toBe(status);
  });

  it("does not derive a Kizunia phase, or expose any field named for one", () => {
    const state = mapped();

    expect(state).not.toHaveProperty("phase");
    expect(state).not.toHaveProperty("contributes");
  });

  it("does not resolve the provider plan to a Kizunia plan", () => {
    // Plan resolution is the apply path's job (catalog validation, Phase IV).
    expect(mapped({ plan_id: "plan_not_in_any_catalog" }).providerPlanId).toBe("plan_not_in_any_catalog");
  });
});

describe("mapSubscriptionEntity — malformed responses are refused, never guessed", () => {
  it("refuses a status it does not recognize", () => {
    expect(reasonFor(entity({ status: "suspended" }))).toContain('unrecognized subscription status "suspended"');
  });

  it("refuses a missing or empty status, id or plan id", () => {
    expect(reasonFor(entity({ status: undefined }))).toContain("status");
    expect(reasonFor(entity({ id: undefined }))).toContain("id");
    expect(reasonFor(entity({ id: "" }))).toContain("id");
    expect(reasonFor(entity({ plan_id: undefined }))).toContain("plan_id");
    expect(reasonFor(entity({ plan_id: 42 }))).toContain("plan_id");
  });

  it("refuses a documented field of the wrong type", () => {
    expect(reasonFor(entity({ current_end: "1792592000" }))).toContain("current_end");
    expect(reasonFor(entity({ charge_at: -5 }))).toContain("charge_at");
    expect(reasonFor(entity({ expire_by: Number.NaN }))).toContain("expire_by");
    expect(reasonFor(entity({ has_scheduled_changes: "false" }))).toContain("has_scheduled_changes");
    expect(reasonFor(entity({ paid_count: 1.5 }))).toContain("paid_count");
    expect(reasonFor(entity({ offer_id: 7 }))).toContain("offer_id");
  });

  it("refuses a body that is not an object", () => {
    for (const body of [undefined, null, "sub_ABC", 42, [], [entity()]]) {
      expect(reasonFor(body)).toContain("not an object");
    }
  });
});

describe("mapSubscriptionEntity — undocumented fields are read defensively (D3)", () => {
  it("reads payment_method and halted_at when present", () => {
    const state = mapped({ payment_method: "emandate", halted_at: 1_791_000_000 });

    expect(state.paymentMethod).toBe("emandate");
    expect(state.haltedAt).toEqual(new Date(1_791_000_000_000));
  });

  it("reads a surprise in them as null, and never fails the response", () => {
    const state = mapped({ payment_method: { unexpected: true }, halted_at: "yesterday" });

    expect(state.paymentMethod).toBeNull();
    expect(state.haltedAt).toBeNull();

    expect(mapped({ payment_method: undefined, halted_at: undefined })).toMatchObject({
      paymentMethod: null,
      haltedAt: null,
    });
    expect(mapped({ halted_at: -1 }).haltedAt).toBeNull();
  });
});

describe("mapSubscriptionEntity — change_scheduled_at is read only when it is a timestamp", () => {
  it("maps a timestamp", () => {
    expect(mapped({ change_scheduled_at: 1_792_592_000 }).changeScheduledAt).toEqual(
      new Date(1_792_592_000_000),
    );
  });

  it("reads now, cycle_end or anything else as null: hasScheduledChanges is the signal", () => {
    for (const value of ["now", "cycle_end", null, undefined, true]) {
      expect(mapped({ change_scheduled_at: value, has_scheduled_changes: true })).toMatchObject({
        changeScheduledAt: null,
        hasScheduledChanges: true,
      });
    }
  });
});

describe("mapSubscriptionEntity — notes", () => {
  it("reads an empty list, which the provider returns for empty notes, as no notes", () => {
    expect(mapped({ notes: [] }).notes).toEqual({});
    expect(mapped({ notes: undefined }).notes).toEqual({});
    expect(mapped({ notes: null }).notes).toEqual({});
  });

  it("keeps only string values", () => {
    expect(mapped({ notes: { kz_sub: "ksub_1", n: 3, flag: true, nested: { a: 1 } } }).notes).toEqual({
      kz_sub: "ksub_1",
    });
  });
});

describe("mapSubscriptionCollection", () => {
  it("maps every item of a collection", () => {
    const result = mapSubscriptionCollection({
      entity: "collection",
      count: 2,
      items: [entity({ id: "sub_1" }), entity({ id: "sub_2", status: "created" })],
    });

    expect(result.ok && result.value.items.map((item) => [item.providerSubscriptionId, item.rawStatus])).toEqual([
      ["sub_1", "active"],
      ["sub_2", "created"],
    ]);
  });

  it("maps an empty collection", () => {
    expect(mapSubscriptionCollection({ entity: "collection", count: 0, items: [] })).toEqual({
      ok: true,
      value: { items: [] },
    });
  });

  it("refuses the whole page when one item is malformed, rather than returning a partial page", () => {
    const result = mapSubscriptionCollection({
      items: [entity({ id: "sub_1" }), entity({ id: "sub_2", status: "suspended" })],
    });

    expect(result.ok).toBe(false);
  });

  it("refuses a body without an items list", () => {
    expect(mapSubscriptionCollection({ entity: "collection" }).ok).toBe(false);
    expect(mapSubscriptionCollection({ items: "nope" }).ok).toBe(false);
    expect(mapSubscriptionCollection(null).ok).toBe(false);
  });
});

describe("mapPaymentEntity", () => {
  it("reads the method and a top-level international flag", () => {
    expect(mapPaymentEntity({ id: "pay_1", method: "card", international: false })).toEqual({
      ok: true,
      value: { method: "card", international: false },
    });
  });

  it("falls back to the card's flag, then to unknown", () => {
    expect(mapPaymentEntity({ method: "card", card: { international: true } })).toEqual({
      ok: true,
      value: { method: "card", international: true },
    });
    expect(mapPaymentEntity({ method: "emandate" })).toEqual({
      ok: true,
      value: { method: "emandate", international: null },
    });
  });

  it("refuses a payment without a method", () => {
    expect(mapPaymentEntity({ id: "pay_1" }).ok).toBe(false);
    expect(mapPaymentEntity("pay_1").ok).toBe(false);
  });
});
