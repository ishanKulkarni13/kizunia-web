/**
 * The global cooldown and the auth pin against real Postgres.
 *
 * The state is one shared `billing_provider_state` row per mode, updated by
 * compare-and-set, so these tests exercise the persistence the pure policy
 * tests cannot: the row itself, a lost race, several instances reacting to one
 * outage, and the pin surviving a restart and lifting when the key changes.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";

import { CLEAN_COOLDOWN_STATE } from "../../policy/cooldown";
import { CooldownRepository } from "./cooldown.repository";
import { keyFingerprint, ProviderHealthTracker } from "./provider-health";

const T0 = new Date("2031-03-01T10:00:00.000Z");
const after = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const KEY_ID = "rzp_test_HealthKey0001";
const settings = { baseSeconds: 30, capSeconds: 900, consecutiveFailureThreshold: 5 };
const noJitter = () => 0.999999999;

function tracker(options: { keyId?: string; now?: Date; mode?: "TEST" | "LIVE" } = {}) {
  return new ProviderHealthTracker(options.mode ?? "TEST", keyFingerprint(options.keyId ?? KEY_ID), {
    settings,
    now: () => options.now ?? T0,
    random: noJitter,
  });
}

async function rowFor(mode: "TEST" | "LIVE" = "TEST") {
  return prisma.billingProviderState.findUnique({ where: { providerMode: mode } });
}

let records: LogRecord[];
const events = (name: string) => records.filter((record) => record.event === name);

beforeEach(async () => {
  await prisma.billingProviderState.deleteMany();
  records = [];
  setLogSink((record) => {
    records.push(record);
  });
});
afterEach(resetLogSink);
afterAll(async () => {
  await prisma.billingProviderState.deleteMany();
  await prisma.$disconnect();
});

describe("a healthy provider costs nothing to track", () => {
  it("is clear with no row, and a healthy result does not create one", async () => {
    expect(await tracker().verdict()).toBe("CLEAR");

    await tracker().record("SUCCESS");
    await tracker().record("REJECTED");

    expect(await rowFor()).toBeNull();
  });

  it("ignores results that say nothing about provider health", async () => {
    await tracker().record("MALFORMED");
    await tracker().record("BUDGET_EXHAUSTED");
    await tracker().record("UNMAPPED_PLAN");

    expect(await rowFor()).toBeNull();
  });
});

describe("a 429 enters a shared cooldown", () => {
  it("persists it, and every instance sees it", async () => {
    await tracker().record("RATE_LIMITED");

    const row = await rowFor();

    expect(row).toMatchObject({ cooldownLevel: 1, consecutiveFailures: 0 });
    expect(row?.cooldownUntil?.getTime()).toBe(after(30).getTime());

    // A different instance, with its own tracker, reads the same row.
    expect(await tracker({ now: after(10) }).verdict()).toBe("COOLING_DOWN");
    expect(events("cooldown.entered")[0].fields).toMatchObject({ mode: "TEST", level: 1, cause: "RATE_LIMITED" });
  });

  it("escalates on a further 429 and never moves the end earlier", async () => {
    await tracker().record("RATE_LIMITED");
    const first = (await rowFor())!.cooldownUntil!.getTime();

    await tracker().record("RATE_LIMITED");
    const second = await rowFor();

    expect(second?.cooldownLevel).toBe(2);
    expect(second!.cooldownUntil!.getTime()).toBeGreaterThan(first);
    expect(second!.cooldownUntil!.getTime()).toBe(after(60).getTime());
  });

  it("ends by itself: the verdict clears once the time has passed", async () => {
    await tracker().record("RATE_LIMITED");

    expect(await tracker({ now: after(29) }).verdict()).toBe("COOLING_DOWN");
    expect(await tracker({ now: after(30) }).verdict()).toBe("CLEAR");
  });

  it("is left on the first success after it, with the level decaying toward zero", async () => {
    await tracker().record("RATE_LIMITED");
    await tracker().record("RATE_LIMITED");

    await tracker({ now: after(120) }).record("SUCCESS");

    expect(await rowFor()).toMatchObject({ cooldownUntil: null, cooldownLevel: 1 });
    expect(events("cooldown.left")).toHaveLength(1);

    await tracker({ now: after(121) }).record("SUCCESS");
    expect(await rowFor()).toMatchObject({ cooldownLevel: 0 });
    expect(events("cooldown.left")).toHaveLength(1);
  });

  it("is not ended by a success while it is still running", async () => {
    await tracker().record("RATE_LIMITED");

    // A priority-1 call got through mid-cooldown.
    await tracker({ now: after(10) }).record("SUCCESS");

    expect(await tracker({ now: after(11) }).verdict()).toBe("COOLING_DOWN");
    expect((await rowFor())?.cooldownUntil?.getTime()).toBe(after(30).getTime());
  });
});

describe("consecutive timeouts and 5xx", () => {
  it("count up, and enter a cooldown at the threshold", async () => {
    for (let i = 0; i < 4; i += 1) await tracker().record(i % 2 === 0 ? "TIMEOUT" : "UNAVAILABLE");

    expect(await rowFor()).toMatchObject({ consecutiveFailures: 4, cooldownUntil: null });
    expect(await tracker().verdict()).toBe("CLEAR");

    await tracker().record("TIMEOUT");

    expect(await rowFor()).toMatchObject({ consecutiveFailures: 0, cooldownLevel: 1 });
    expect(await tracker().verdict()).toBe("COOLING_DOWN");
  });

  it("are broken by a definite answer from the provider", async () => {
    for (let i = 0; i < 4; i += 1) await tracker().record("TIMEOUT");
    await tracker().record("NOT_FOUND");
    await tracker().record("TIMEOUT");

    expect(await rowFor()).toMatchObject({ consecutiveFailures: 1, cooldownUntil: null });
  });
});

describe("the auth-failure pin", () => {
  it("stops every call, and pages, without ever logging the key", async () => {
    await tracker().record("AUTH_FAILURE");

    expect(await tracker().verdict()).toBe("AUTH_PINNED");
    expect((await rowFor())?.authFailurePinnedKeyFingerprint).toBe(keyFingerprint(KEY_ID));

    expect(events("billing.alert")[0].fields).toMatchObject({ condition: "AUTH_FAILURE", severity: "PAGE" });
    expect(JSON.stringify(records)).not.toContain(KEY_ID);
  });

  it("survives a restart: the pin is in the database, not in memory", async () => {
    await tracker().record("AUTH_FAILURE");

    // A brand new tracker, as after a redeploy with the same key.
    expect(await tracker({ now: after(86_400) }).verdict()).toBe("AUTH_PINNED");
  });

  it("lifts when the key is rotated and the app redeployed, with no manual SQL", async () => {
    await tracker().record("AUTH_FAILURE");

    const rotated = tracker({ keyId: "rzp_test_HealthKey0002" });

    expect(await rotated.verdict()).toBe("CLEAR");

    // The first call that works with the new key clears the stale pin.
    await rotated.record("SUCCESS");
    expect((await rowFor())?.authFailurePinnedKeyFingerprint).toBeNull();
  });

  it("fingerprints the key without exposing it", () => {
    const fingerprint = keyFingerprint(KEY_ID);

    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint).not.toContain("HealthKey");
    expect(keyFingerprint(KEY_ID)).toBe(fingerprint);
    expect(keyFingerprint("rzp_test_HealthKey0002")).not.toBe(fingerprint);
  });
});

describe("modes are independent", () => {
  it("keeps TEST and LIVE state apart", async () => {
    await tracker({ mode: "TEST" }).record("RATE_LIMITED");

    expect(await tracker({ mode: "TEST" }).verdict()).toBe("COOLING_DOWN");
    expect(await tracker({ mode: "LIVE" }).verdict()).toBe("CLEAR");
    expect(await rowFor("LIVE")).toBeNull();
  });
});

describe("several instances reacting to one outage", () => {
  it("converge on one consistent cooldown, with no error and no lost row", async () => {
    await Promise.all(Array.from({ length: 8 }, () => tracker().record("RATE_LIMITED")));

    const row = await rowFor();

    expect(row?.cooldownUntil?.getTime()).toBeGreaterThan(T0.getTime());
    expect(row!.cooldownLevel).toBeGreaterThanOrEqual(1);
    expect(row!.cooldownLevel).toBeLessThanOrEqual(8);
    expect(await tracker({ now: after(1) }).verdict()).toBe("COOLING_DOWN");
  });

  it("never moves the cooldown end earlier, however the writes interleave", async () => {
    await tracker().record("RATE_LIMITED");
    await tracker().record("RATE_LIMITED");
    await tracker().record("RATE_LIMITED");
    const settled = (await rowFor())!.cooldownUntil!.getTime();

    await Promise.all(Array.from({ length: 6 }, () => tracker().record("RATE_LIMITED")));

    expect((await rowFor())!.cooldownUntil!.getTime()).toBeGreaterThanOrEqual(settled);
  });
});

describe("CooldownRepository — compare-and-set", () => {
  it("refuses a write based on a stale read", async () => {
    const repository = new CooldownRepository();
    await tracker().record("RATE_LIMITED");

    const stale = await repository.load("TEST");
    await tracker().record("RATE_LIMITED"); // someone else moves the row on

    const written = await repository.compareAndSet("TEST", stale, {
      ...CLEAN_COOLDOWN_STATE,
      cooldownLevel: 99,
    });

    expect(written).toBe(false);
    expect((await rowFor())?.cooldownLevel).toBe(2);
  });

  it("lets exactly one of two racing creators win, and reports the loser as a lost race", async () => {
    const repository = new CooldownRepository();
    const [first, second] = await Promise.all([repository.load("TEST"), repository.load("TEST")]);

    const results = await Promise.all([
      repository.compareAndSet("TEST", first, { ...CLEAN_COOLDOWN_STATE, cooldownLevel: 1 }),
      repository.compareAndSet("TEST", second, { ...CLEAN_COOLDOWN_STATE, cooldownLevel: 2 }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.billingProviderState.count()).toBe(1);
  });

  it("reads a mode with no row as a clean state", async () => {
    expect(await new CooldownRepository().load("LIVE")).toEqual({ state: CLEAN_COOLDOWN_STATE, version: null });
  });
});
