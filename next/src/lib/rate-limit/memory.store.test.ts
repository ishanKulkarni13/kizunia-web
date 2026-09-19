import { describe, expect, it } from "vitest";

import { InMemoryRateLimitStore } from "./memory.store";

describe("InMemoryRateLimitStore", () => {
  it("starts a new key at 1", async () => {
    const store = new InMemoryRateLimitStore();

    const result = await store.increment("k", new Date(Date.now() + 60_000));

    expect(result.count).toBe(1);
  });

  it("increments an existing, unexpired key", async () => {
    const store = new InMemoryRateLimitStore();
    const expiresAt = new Date(Date.now() + 60_000);

    await store.increment("k", expiresAt);
    await store.increment("k", expiresAt);
    const third = await store.increment("k", expiresAt);

    expect(third.count).toBe(3);
  });

  it("treats an expired key as a fresh window", async () => {
    const store = new InMemoryRateLimitStore();

    await store.increment("k", new Date(Date.now() - 1));

    const result = await store.increment("k", new Date(Date.now() + 60_000));

    expect(result.count).toBe(1);
  });

  it("prune removes only expired entries", async () => {
    const store = new InMemoryRateLimitStore();

    await store.increment("expired", new Date(Date.now() - 1));
    await store.increment("live", new Date(Date.now() + 60_000));

    const pruned = await store.prune();

    expect(pruned).toBe(1);

    // The live key should still be there and still accumulate.
    const result = await store.increment("live", new Date(Date.now() + 60_000));

    expect(result.count).toBe(2);
  });
});
