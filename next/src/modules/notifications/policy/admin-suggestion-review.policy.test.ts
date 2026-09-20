import { describe, expect, it } from "vitest";

import {
  isSuggestionStillAwaitingReview,
  shouldNotifyReviewer,
  type AdminSuggestionState,
} from "./admin-suggestion-review.policy";

const SUBMITTED_AT = new Date("2026-09-17T13:00:00.000Z");

function state(overrides: Partial<AdminSuggestionState> = {}): AdminSuggestionState {
  return {
    status: "UNDER_REVIEW",
    deletedAt: null,
    reviewedAt: null,
    submittedAt: SUBMITTED_AT,
    submittedById: "submitter-1",
    ...overrides,
  };
}

describe("isSuggestionStillAwaitingReview", () => {
  it("is eligible when the suggestion is exactly what the job was scheduled about", () => {
    const decision = isSuggestionStillAwaitingReview(state(), SUBMITTED_AT);
    expect(decision).toEqual({ eligible: true });
  });

  it.each([
    ["reviewed", state({ reviewedAt: new Date() })],
    ["approved and reviewed", state({ status: "APPROVED", reviewedAt: new Date() })],
    ["withdrawn", state({ status: "WITHDRAWN" })],
    ["changes requested", state({ status: "CHANGES_REQUESTED" })],
    ["soft-deleted", state({ deletedAt: new Date() })],
    ["never actually submitted", state({ submittedAt: null })],
  ])("suppresses when %s", (_label, s) => {
    const decision = isSuggestionStillAwaitingReview(s, SUBMITTED_AT);
    expect(decision).toEqual({
      eligible: false,
      reason: "NO_LONGER_AWAITING_REVIEW",
    });
  });

  it("suppresses as superseded when submittedAt has moved past the frozen occasion", () => {
    const resubmittedAt = new Date(SUBMITTED_AT.getTime() + 60_000);
    const decision = isSuggestionStillAwaitingReview(
      state({ submittedAt: resubmittedAt }),
      SUBMITTED_AT,
    );
    expect(decision).toEqual({
      eligible: false,
      reason: "SUPERSEDED_BY_RESUBMISSION",
    });
  });

  it("still under review at the exact frozen instant is not treated as superseded", () => {
    // Guards against a millisecond-precision bug: comparing by value, not by
    // reference, so a Date reconstructed from a round-tripped ISO string still
    // matches.
    const roundTripped = new Date(SUBMITTED_AT.toISOString());
    const decision = isSuggestionStillAwaitingReview(
      state({ submittedAt: roundTripped }),
      SUBMITTED_AT,
    );
    expect(decision.eligible).toBe(true);
  });
});

describe("shouldNotifyReviewer", () => {
  it("is eligible for an ordinary reviewer with the intent on", () => {
    const decision = shouldNotifyReviewer(
      { recipientId: "reviewer-1", intentEnabled: true },
      state(),
    );
    expect(decision).toEqual({ eligible: true });
  });

  it("suppresses the submitter, even though they otherwise qualify", () => {
    const decision = shouldNotifyReviewer(
      { recipientId: "submitter-1", intentEnabled: true },
      state({ submittedById: "submitter-1" }),
    );
    expect(decision).toEqual({
      eligible: false,
      reason: "RECIPIENT_IS_SUBMITTER",
    });
  });

  it("suppresses a reviewer who switched the intent off", () => {
    const decision = shouldNotifyReviewer(
      { recipientId: "reviewer-1", intentEnabled: false },
      state(),
    );
    expect(decision).toEqual({ eligible: false, reason: "INTENT_DISABLED" });
  });

  it("checks the submitter before the intent flag", () => {
    // A submitter who also has the intent off should read as
    // RECIPIENT_IS_SUBMITTER, not INTENT_DISABLED — the more specific,
    // permanent fact about *why* they are not told.
    const decision = shouldNotifyReviewer(
      { recipientId: "submitter-1", intentEnabled: false },
      state({ submittedById: "submitter-1" }),
    );
    expect(decision).toEqual({
      eligible: false,
      reason: "RECIPIENT_IS_SUBMITTER",
    });
  });
});
