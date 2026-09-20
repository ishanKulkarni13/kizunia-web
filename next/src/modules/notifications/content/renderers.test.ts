/**
 * No dedicated unit test exists yet for the other renderers in this file —
 * they are exercised through `notification-pipeline.integration.test.ts` and
 * `announcement.integration.test.ts`, which assert on the rendered
 * notification anyway once it is persisted. This file covers only
 * `renderAdminSuggestionReview`, whose one interesting branch (an
 * unresolvable submitter name) is otherwise untested by either integration
 * suite.
 */
import { describe, expect, it } from "vitest";

import { renderAdminSuggestionReview } from "./renderers";

describe("renderAdminSuggestionReview", () => {
  const submittedAt = new Date("2026-09-17T13:00:00.000Z");

  it("names the submitter when one is known", () => {
    const draft = renderAdminSuggestionReview("reviewer-1", "suggestion:sugg-1:2026-09-17T13:00:00.000Z", {
      id: "sugg-1",
      title: "Global Hackathon 2027",
      submittedBy: "Priya Sharma",
      submittedAt,
    });

    expect(draft.body).toBe(
      '"Global Hackathon 2027" from Priya Sharma is waiting for review.',
    );
  });

  it("degrades gracefully when the submitter cannot be resolved", () => {
    const draft = renderAdminSuggestionReview("reviewer-1", "occ", {
      id: "sugg-1",
      title: "Global Hackathon 2027",
      submittedBy: null,
      submittedAt,
    });

    expect(draft.body).toBe('"Global Hackathon 2027" is waiting for review.');
  });

  it("points at the admin review page for this suggestion", () => {
    const draft = renderAdminSuggestionReview("reviewer-1", "occ", {
      id: "sugg-1",
      title: "T",
      submittedBy: null,
      submittedAt,
    });

    expect(draft.actionPath).toBe("/admin/competition-suggestions/sugg-1");
  });

  it("carries exactly one target, versioned by the submission instant", () => {
    const draft = renderAdminSuggestionReview("reviewer-1", "occ", {
      id: "sugg-1",
      title: "T",
      submittedBy: null,
      submittedAt,
    });

    expect(draft.targets).toEqual([
      {
        targetType: "COMPETITION_SUGGESTION",
        targetId: "sugg-1",
        targetVersion: submittedAt.toISOString(),
        rank: 1,
      },
    ]);
  });

  it("carries the recipient, intent and occurrence key it was given", () => {
    const draft = renderAdminSuggestionReview(
      "reviewer-1",
      "suggestion:sugg-1:2026-09-17T13:00:00.000Z",
      { id: "sugg-1", title: "T", submittedBy: null, submittedAt },
    );

    expect(draft.userId).toBe("reviewer-1");
    expect(draft.intent).toBe("ADMIN_COMPETITION_SUGGESTION");
    expect(draft.occurrenceKey).toBe(
      "suggestion:sugg-1:2026-09-17T13:00:00.000Z",
    );
  });

  it("puts the machine-readable facts in the payload", () => {
    const draft = renderAdminSuggestionReview("reviewer-1", "occ", {
      id: "sugg-1",
      title: "Global Hackathon 2027",
      submittedBy: "Priya Sharma",
      submittedAt,
    });

    expect(draft.payload).toEqual({
      suggestionId: "sugg-1",
      suggestionTitle: "Global Hackathon 2027",
      submittedBy: "Priya Sharma",
      submittedAt: submittedAt.toISOString(),
    });
  });
});
