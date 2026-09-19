import type { RateLimitIncrementResult, RateLimitStore } from "./store";

/**
 * In-memory store. Tests only — this is what makes `RateLimitService`
 * unit-testable without a database. Never wired into a request path: it has
 * no cross-instance guarantee, which is precisely why the app uses Postgres
 * in production (see postgres.store.ts).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<
    string,
    { count: number; expiresAt: Date }
  >();

  async increment(
    key: string,
    expiresAt: Date,
  ): Promise<RateLimitIncrementResult> {
    const existing = this.counters.get(key);

    if (existing && existing.expiresAt > new Date()) {
      existing.count += 1;

      return { count: existing.count };
    }

    this.counters.set(key, { count: 1, expiresAt });

    return { count: 1 };
  }

  async prune(): Promise<number> {
    const now = new Date();

    let pruned = 0;

    for (const [key, entry] of this.counters) {
      if (entry.expiresAt < now) {
        this.counters.delete(key);
        pruned += 1;
      }
    }

    return pruned;
  }
}
