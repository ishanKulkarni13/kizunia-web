/**
 * Covers the whole `TOP_RELEVANT_COMPETITION` decision. The policy is pure, so
 * these are plain unit tests — no database, no mocks, hand-built fixtures, in
 * the style of `modules/recommendations/engine/*.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";
import type { RecommendationItemDTO } from "@/modules/recommendations";

import { evaluateTopRelevantCompetition } from "./top-relevant-competition.policy";

const NOW = new Date("2026-09-17T00:00:00.000Z");
const USER_ID = "user-1";

function card(id: string): CompetitionCardDTO {
  return {
    id,
    slug: id,
    title: `Competition ${id}`,
    shortDescription: null,
    organizer: null,
    registrationPlatform: null,
    locations: [],
    mode: null,
    status: null,
    startDate: null,
    registrationDeadline: null,
    registrationFeeType: null,
    minTeamSize: null,
    maxTeamSize: null,
    logoUrl: null,
    coverUrl: null,
    types: [],
  };
}

function item(id: string, rank: number, score: number): RecommendationItemDTO {
  return { competition: card(id), rank, score };
}

describe("evaluateTopRelevantCompetition", () => {
  it("selects the top competition when the intent is enabled and recommendations exist", () => {
    const decision = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: true,
      entitled: true,
      recommendations: [item("comp-a", 1, 0.9)],
      now: NOW,
    });

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) throw new Error("expected an eligible decision");

    expect(decision.intent).toBe("TOP_RELEVANT_COMPETITION");
    expect(decision.userId).toBe(USER_ID);
    expect(decision.subjects[0].competitionId).toBe("comp-a");
    expect(decision.subjects[0].competition.id).toBe("comp-a");
    expect(decision.subjects[0].score).toBe(0.9);
    expect(decision.subjects[0].rank).toBe(1);
  });

  it("suppresses when the intent is disabled, even though recommendations exist", () => {
    const decision = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: false,
      entitled: true,
      recommendations: [item("comp-a", 1, 0.9)],
      now: NOW,
    });

    expect(decision.eligible).toBe(false);
    if (decision.eligible) throw new Error("expected a suppressed decision");

    expect(decision.reason).toBe("INTENT_DISABLED");
  });

  it("suppresses when the intent is enabled but nothing was recommended", () => {
    const decision = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: true,
      entitled: true,
      recommendations: [],
      now: NOW,
    });

    expect(decision.eligible).toBe(false);
    if (decision.eligible) throw new Error("expected a suppressed decision");

    expect(decision.reason).toBe("NO_RECOMMENDATIONS");
  });

  it("selects exactly one competition — the highest-ranked — out of many", () => {
    const decision = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: true,
      entitled: true,
      recommendations: [
        item("comp-a", 1, 0.91),
        item("comp-b", 2, 0.77),
        item("comp-c", 3, 0.62),
      ],
      now: NOW,
    });

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) throw new Error("expected an eligible decision");

    // The contract is a single subject, not a list — ND-I-06.
    expect(decision.subjects[0].competitionId).toBe("comp-a");
    expect(decision.subjects[0].rank).toBe(1);
  });

  it("reports the disabled intent, not the empty result, when both are true", () => {
    const decision = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: false,
      entitled: true,
      recommendations: [],
      now: NOW,
    });

    expect(decision.eligible).toBe(false);
    if (decision.eligible) throw new Error("expected a suppressed decision");

    expect(decision.reason).toBe("INTENT_DISABLED");
  });

  it("picks the true top even when the items are not supplied in rank order", () => {
    const decision = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: true,
      entitled: true,
      recommendations: [
        item("comp-c", 3, 0.62),
        item("comp-a", 1, 0.91),
        item("comp-b", 2, 0.77),
      ],
      now: NOW,
    });

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) throw new Error("expected an eligible decision");

    expect(decision.subjects[0].competitionId).toBe("comp-a");
  });

  it("echoes the injected evaluation time on both outcomes", () => {
    const eligible = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: true,
      entitled: true,
      recommendations: [item("comp-a", 1, 0.9)],
      now: NOW,
    });
    const suppressed = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: false,
      entitled: true,
      recommendations: [],
      now: NOW,
    });

    expect(eligible.evaluatedAt).toBe(NOW);
    expect(suppressed.evaluatedAt).toBe(NOW);
  });

  it("suppresses NOT_ENTITLED when the user lacks the capability, even with recommendations", () => {
    const decision = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: true,
      entitled: false,
      recommendations: [item("comp-a", 1, 0.9)],
      now: NOW,
    });

    expect(decision.eligible).toBe(false);
    if (decision.eligible) throw new Error("expected a suppressed decision");

    expect(decision.reason).toBe("NOT_ENTITLED");
  });

  it("reports the disabled intent, not the missing entitlement, when both are true", () => {
    const decision = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: false,
      entitled: false,
      recommendations: [],
      now: NOW,
    });

    expect(decision.eligible).toBe(false);
    if (decision.eligible) throw new Error("expected a suppressed decision");

    expect(decision.reason).toBe("INTENT_DISABLED");
  });

  it("reports the missing entitlement, not the empty result, when both are true", () => {
    const decision = evaluateTopRelevantCompetition({
      userId: USER_ID,
      enabled: true,
      entitled: false,
      recommendations: [],
      now: NOW,
    });

    expect(decision.eligible).toBe(false);
    if (decision.eligible) throw new Error("expected a suppressed decision");

    expect(decision.reason).toBe("NOT_ENTITLED");
  });
});
