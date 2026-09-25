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

  describe("incrementIfBelow", () => {
    const ahead = () => new Date(Date.now() + 60_000);

    it("admits up to the ceiling, then refuses without counting the refusal", async () => {
      const store = new InMemoryRateLimitStore();

      const results = [];
      for (let i = 0; i < 5; i += 1) results.push(await store.incrementIfBelow("k", 3, ahead()));

      expect(results).toEqual([
        { acquired: true, count: 1 },
        { acquired: true, count: 2 },
        { acquired: true, count: 3 },
        { acquired: false },
        { acquired: false },
      ]);

      // Refusals changed nothing: a plain increment continues from the ceiling.
      expect((await store.increment("k", ahead())).count).toBe(4);
    });

    it("keeps keys independent", async () => {
      const store = new InMemoryRateLimitStore();

      await store.incrementIfBelow("a", 1, ahead());

      expect(await store.incrementIfBelow("a", 1, ahead())).toEqual({ acquired: false });
      expect(await store.incrementIfBelow("b", 1, ahead())).toEqual({ acquired: true, count: 1 });
    });

    it("admits nothing, and writes nothing, for a ceiling below 1", async () => {
      const store = new InMemoryRateLimitStore();

      expect(await store.incrementIfBelow("k", 0, ahead())).toEqual({ acquired: false });
      expect(await store.incrementIfBelow("k", -3, ahead())).toEqual({ acquired: false });

      // Nothing was created, so the first plain increment is the first count.
      expect((await store.increment("k", ahead())).count).toBe(1);
    });

    it("treats an expired key as a fresh window", async () => {
      const store = new InMemoryRateLimitStore();

      await store.incrementIfBelow("k", 1, new Date(Date.now() - 1));

      expect(await store.incrementIfBelow("k", 1, ahead())).toEqual({ acquired: true, count: 1 });
    });

    it("admits exactly the ceiling under concurrent callers", async () => {
      const store = new InMemoryRateLimitStore();

      const results = await Promise.all(
        Array.from({ length: 20 }, () => store.incrementIfBelow("k", 7, ahead())),
      );

      expect(results.filter((result) => result.acquired)).toHaveLength(7);
    });
  });
});
