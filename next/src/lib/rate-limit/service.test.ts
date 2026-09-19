import { describe, expect, it } from "vitest";

import { RateLimitError } from "@/lib/errors";

import { resetRateLimitEventSink, setRateLimitEventSink, type RateLimitEvent } from "./events";
import { InMemoryRateLimitStore } from "./memory.store";
import { RATE_LIMIT_POLICIES, RateLimitPolicyId } from "./policies";
import { RateLimitService } from "./service";
import type { RateLimitStore } from "./store";

function request(ip = "203.0.113.10"): Request {
  return new Request("https://kizunia.test/x", { headers: { "x-real-ip": ip } });
}

/** A store that always fails, to exercise the failure-mode dispatch. */
class ThrowingStore implements RateLimitStore {
  async increment(): Promise<never> {
    throw new Error("simulated store outage");
  }

  async prune(): Promise<number> {
    return 0;
  }
}

describe("RateLimitService.check — ordinary enforcement", () => {
  it("allows a request below the limit and reports the correct remaining count", async () => {
    const service = new RateLimitService(new InMemoryRateLimitStore());

    const decision = await service.check({
      policyId: RateLimitPolicyId.AUTH_SIGN_IN,
      request: request(),
      credential: "person@example.com",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.limit).toBe(10);
    expect(decision.remaining).toBe(9);
  });

  it("allows exactly up to the limit, then rejects the next request", async () => {
    const service = new RateLimitService(new InMemoryRateLimitStore());
    const input = {
      policyId: RateLimitPolicyId.AUTH_SIGN_IN,
      request: request(),
      credential: "person@example.com",
    };

    let last;

    for (let i = 0; i < 10; i++) {
      last = await service.check(input);
      expect(last.allowed).toBe(true);
    }

    expect(last!.remaining).toBe(0);

    const eleventh = await service.check(input);

    expect(eleventh.allowed).toBe(false);
    expect(eleventh.remaining).toBe(0);
  });

  it("rejects when ANY configured subject dimension is exceeded, not just all of them", async () => {
    const service = new RateLimitService(new InMemoryRateLimitStore());

    // Ten distinct IPs, same credential: the IP dimension never gets close
    // to its own limit, but the credential dimension accumulates across
    // every call.
    for (let i = 0; i < 10; i++) {
      await service.check({
        policyId: RateLimitPolicyId.AUTH_SIGN_IN,
        request: request(`203.0.113.${i}`),
        credential: "same@example.com",
      });
    }

    const decision = await service.check({
      policyId: RateLimitPolicyId.AUTH_SIGN_IN,
      request: request("203.0.113.250"),
      credential: "same@example.com",
    });

    expect(decision.allowed).toBe(false);
  });

  it("produces exact, sequential counts under concurrent checks against the same key", async () => {
    // This validates the service + store's per-tick accounting under
    // concurrent invocation — 50 simultaneous `check()` calls against one
    // key must produce 50 distinct, sequential counts with none lost or
    // duplicated. It does not exercise cross-process atomicity: that
    // guarantee comes from Postgres's real `INSERT ... ON CONFLICT DO
    // UPDATE SET count = count + 1` (see postgres.store.ts), which is
    // covered separately in postgres.store.integration.test.ts against a
    // live database, not something an in-memory store can prove on its own.
    const service = new RateLimitService(new InMemoryRateLimitStore());
    const input = { policyId: RateLimitPolicyId.TAXONOMY_CATEGORIES, request: request() };

    const results = await Promise.all(
      Array.from({ length: 50 }, () => service.check(input)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(50);

    const remainders = results.map((r) => r.remaining).sort((a, b) => b - a);
    const expected = Array.from({ length: 50 }, (_, i) => 119 - i);

    expect(remainders).toEqual(expected);
  });
});

describe("RateLimitService — failure modes", () => {
  it("fails open when the store throws and the policy's failure mode is open", async () => {
    const service = new RateLimitService(new ThrowingStore());

    const decision = await service.check({
      policyId: RateLimitPolicyId.TAXONOMY_CATEGORIES,
      request: request(),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(
      RATE_LIMIT_POLICIES[RateLimitPolicyId.TAXONOMY_CATEGORIES].limit,
    );
  });

  it("fails closed when the store throws and the policy's failure mode is closed", async () => {
    const service = new RateLimitService(new ThrowingStore());

    const decision = await service.check({
      policyId: RateLimitPolicyId.ASSETS_UPLOAD_INTENT,
      actor: { id: "user_1" },
    });

    expect(decision.allowed).toBe(false);
  });

  it("enforce() throws RateLimitError when a store outage fails a closed policy", async () => {
    const service = new RateLimitService(new ThrowingStore());

    await expect(
      service.enforce({
        policyId: RateLimitPolicyId.ASSETS_UPLOAD_INTENT,
        actor: { id: "user_1" },
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("RateLimitService.enforce — HTTP-facing rejection", () => {
  it("throws a RateLimitError carrying limit/remaining/retryAfterSeconds on an ordinary breach", async () => {
    const service = new RateLimitService(new InMemoryRateLimitStore());
    const input = {
      policyId: RateLimitPolicyId.AUTH_SIGN_IN,
      request: request(),
      credential: "person@example.com",
    };

    for (let i = 0; i < 10; i++) {
      await service.enforce(input);
    }

    await expect(service.enforce(input)).rejects.toMatchObject({
      status: 429,
      limit: 10,
      remaining: 0,
    });
  });

  it("derives a stable error code from the policy id", async () => {
    const service = new RateLimitService(new InMemoryRateLimitStore());
    const input = {
      policyId: RateLimitPolicyId.AUTH_SIGN_UP,
      request: request(),
    };

    for (let i = 0; i < 20; i++) {
      await service.enforce(input);
    }

    await expect(service.enforce(input)).rejects.toMatchObject({
      code: "AUTH_SIGN_UP_RATE_LIMITED",
    });
  });
});

describe("RateLimitService — observability events", () => {
  it("emits rate_limit.allowed for a successful check", async () => {
    const events: RateLimitEvent[] = [];

    setRateLimitEventSink((event) => events.push(event));

    try {
      const service = new RateLimitService(new InMemoryRateLimitStore());

      await service.check({
        policyId: RateLimitPolicyId.TAXONOMY_CATEGORIES,
        request: request(),
      });

      expect(events.some((e) => e.name === "rate_limit.allowed")).toBe(true);
    } finally {
      resetRateLimitEventSink();
    }
  });

  it("emits rate_limit.failed_open on a store outage under a fail-open policy", async () => {
    const events: RateLimitEvent[] = [];

    setRateLimitEventSink((event) => events.push(event));

    try {
      const service = new RateLimitService(new ThrowingStore());

      await service.check({
        policyId: RateLimitPolicyId.TAXONOMY_CATEGORIES,
        request: request(),
      });

      expect(events.some((e) => e.name === "rate_limit.failed_open")).toBe(
        true,
      );
    } finally {
      resetRateLimitEventSink();
    }
  });

  it("emits rate_limit.failed_closed on a store outage under a fail-closed policy", async () => {
    const events: RateLimitEvent[] = [];

    setRateLimitEventSink((event) => events.push(event));

    try {
      const service = new RateLimitService(new ThrowingStore());

      await service.check({
        policyId: RateLimitPolicyId.ASSETS_UPLOAD_INTENT,
        actor: { id: "user_1" },
      });

      expect(events.some((e) => e.name === "rate_limit.failed_closed")).toBe(
        true,
      );
    } finally {
      resetRateLimitEventSink();
    }
  });

  it("never logs a raw subject id — only the subject kind", async () => {
    const events: RateLimitEvent[] = [];

    setRateLimitEventSink((event) => events.push(event));

    try {
      const service = new RateLimitService(new InMemoryRateLimitStore());

      await service.check({
        policyId: RateLimitPolicyId.PLACES_AUTOCOMPLETE,
        request: request("203.0.113.77"),
      });

      for (const event of events) {
        expect(JSON.stringify(event)).not.toContain("203.0.113.77");
      }
    } finally {
      resetRateLimitEventSink();
    }
  });
});
