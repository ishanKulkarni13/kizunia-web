import { describe, expect, it } from "vitest";

import {
  ApplyAssetReconciliationSchema,
  MAX_RECONCILIATION_APPLY_IDS,
} from "./apply-asset-reconciliation";

function cuid(n: number): string {
  return `c${String(n).padStart(24, "0")}`;
}

describe("ApplyAssetReconciliationSchema", () => {
  it("accepts a single valid id", () => {
    const result = ApplyAssetReconciliationSchema.safeParse({ ids: [cuid(1)] });
    expect(result.success).toBe(true);
  });

  it("accepts exactly MAX_RECONCILIATION_APPLY_IDS ids", () => {
    const ids = Array.from({ length: MAX_RECONCILIATION_APPLY_IDS }, (_, i) => cuid(i));
    const result = ApplyAssetReconciliationSchema.safeParse({ ids });
    expect(result.success).toBe(true);
  });

  it("rejects an empty array", () => {
    const result = ApplyAssetReconciliationSchema.safeParse({ ids: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than MAX_RECONCILIATION_APPLY_IDS ids", () => {
    const ids = Array.from(
      { length: MAX_RECONCILIATION_APPLY_IDS + 1 },
      (_, i) => cuid(i),
    );
    const result = ApplyAssetReconciliationSchema.safeParse({ ids });
    expect(result.success).toBe(false);
  });

  it("rejects a non-cuid entry", () => {
    const result = ApplyAssetReconciliationSchema.safeParse({
      ids: ["not-a-cuid"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing ids field", () => {
    const result = ApplyAssetReconciliationSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
