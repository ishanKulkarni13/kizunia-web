import { describe, expect, it } from "vitest";

import type { ProviderFailureClass } from "@/generated/prisma";

import { providerFailure, providerSuccess } from "../provider/types";
import { classifyMutationOutcome } from "./command-outcome";

const SENT = new Date("2026-09-25T12:00:00Z");

describe("classifyMutationOutcome (operation-model.md)", () => {
  it("is SUCCESS for an entity, with the send time as requestSentAt", () => {
    expect(classifyMutationOutcome(providerSuccess({ id: 1 }, SENT))).toEqual({
      kind: "SUCCESS",
      value: { id: 1 },
      requestSentAt: SENT,
    });
  });

  it("is a plain REJECTED when nothing was sent (budget, cooldown, auth pin, unmapped plan)", () => {
    for (const failureClass of ["BUDGET_EXHAUSTED", "UNMAPPED_PLAN", "AUTH_FAILURE"] as const) {
      const classified = classifyMutationOutcome(providerFailure(failureClass));

      expect(classified).toMatchObject({ kind: "REJECTED", failureClass, requestSentAt: null });
    }
  });

  it.each<ProviderFailureClass>(["REJECTED", "RATE_LIMITED", "AUTH_FAILURE", "CONCURRENT_OPERATION", "NOT_FOUND"])(
    "is REJECTED for %s that reached the provider: it was not processed",
    (failureClass) => {
      const classified = classifyMutationOutcome(
        providerFailure(failureClass, { requestSentAt: SENT, providerErrorCode: "BAD_REQUEST_ERROR" }),
      );

      expect(classified).toEqual({
        kind: "REJECTED",
        failureClass,
        requestSentAt: SENT,
        providerErrorCode: "BAD_REQUEST_ERROR",
        providerErrorDescription: null,
      });
    },
  );

  it.each<ProviderFailureClass>(["TIMEOUT", "UNAVAILABLE", "MALFORMED"])(
    "is OUTCOME_UNKNOWN for %s after the request left: it may have been applied",
    (failureClass) => {
      expect(classifyMutationOutcome(providerFailure(failureClass, { requestSentAt: SENT }))).toMatchObject({
        kind: "OUTCOME_UNKNOWN",
        failureClass,
        requestSentAt: SENT,
      });
    },
  );

  it("is DISABLED when billing is disabled", () => {
    expect(classifyMutationOutcome({ kind: "PROVIDER_DISABLED" })).toEqual({ kind: "DISABLED" });
  });
});
