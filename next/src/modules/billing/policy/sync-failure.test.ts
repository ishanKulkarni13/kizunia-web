import { describe, expect, it } from "vitest";

import type { ProviderFailureClass } from "@/generated/prisma";

import { interpretSyncFetchFailure } from "./sync-failure";

describe("interpretSyncFetchFailure — missing-subscription detection (IB-23)", () => {
  it("reads REJECTED and NOT_FOUND on a sync fetch of a stored ID as a missing provider subscription", () => {
    expect(interpretSyncFetchFailure("REJECTED", true)).toEqual({ outcome: "PROVIDER_MISSING", stopBatch: false });
    expect(interpretSyncFetchFailure("NOT_FOUND", true)).toEqual({ outcome: "PROVIDER_MISSING", stopBatch: false });
  });

  it("decides by the operation alone: the pinned D12 bodies classify as REJECTED and NOT_FOUND", () => {
    // classification.test.ts pins the observed bodies: an unknown well-formed ID
    // is 400 BAD_REQUEST_ERROR -> REJECTED; a malformed ID is a gateway 404 ->
    // NOT_FOUND. No description text reaches this function, so no wording change
    // at Razorpay can move a missing subscription into another outcome.
    for (const failureClass of ["REJECTED", "NOT_FOUND"] as const) {
      expect(interpretSyncFetchFailure(failureClass, true).outcome).toBe("PROVIDER_MISSING");
    }
  });
});

describe("interpretSyncFetchFailure — everything else", () => {
  it("treats a call that never left the process as not attempted, and stops the batch", () => {
    expect(interpretSyncFetchFailure("BUDGET_EXHAUSTED", false)).toEqual({ outcome: "NOT_ATTEMPTED", stopBatch: true });
    // An auth pin refuses without sending.
    expect(interpretSyncFetchFailure("AUTH_FAILURE", false)).toEqual({ outcome: "NOT_ATTEMPTED", stopBatch: true });
  });

  it("stops the batch on a real 401/403 or a 429, backing the row off", () => {
    expect(interpretSyncFetchFailure("AUTH_FAILURE", true)).toEqual({ outcome: "RETRY", stopBatch: true });
    expect(interpretSyncFetchFailure("RATE_LIMITED", true)).toEqual({ outcome: "RETRY", stopBatch: true });
  });

  it.each<ProviderFailureClass>(["TIMEOUT", "UNAVAILABLE", "CONCURRENT_OPERATION", "MALFORMED", "UNMAPPED_PLAN"])(
    "backs off %s and carries on",
    (failureClass) => {
      expect(interpretSyncFetchFailure(failureClass, true)).toEqual({ outcome: "RETRY", stopBatch: false });
    },
  );
});
