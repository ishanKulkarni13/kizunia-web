import { describe, expect, it } from "vitest";

import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";

import {
  evaluateRegistrationClosing,
  occasionKey,
  type DeadlineCandidate,
  type RegistrationClosingInput,
} from "./registration-closing.policy";

const NOW = new Date("2026-09-17T13:00:00.000Z");

function card(id: string): CompetitionCardDTO {
  return {
    id,
    slug: `${id}-slug`,
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

function candidate(id: string, deadlineIso: string): DeadlineCandidate {
  return {
    competitionId: id,
    competition: card(id),
    deadline: new Date(deadlineIso),
  };
}

function input(
  overrides: Partial<RegistrationClosingInput> = {},
): RegistrationClosingInput {
  return {
    userId: "user-1",
    enabled: true,
    entitled: true,
    candidates: [],
    relevanceById: new Map(),
    bookmarkedIds: new Set(),
    registeredIds: new Set(),
    alreadyNotifiedKeys: new Set(),
    maxSubjects: 5,
    now: NOW,
    ...overrides,
  };
}

describe("evaluateRegistrationClosing", () => {
  it("reports an opted-out user as opted out, before looking at anything else", () => {
    const decision = evaluateRegistrationClosing(
      input({
        enabled: false,
        candidates: [candidate("a", "2026-09-19T13:00:00Z")],
        relevanceById: new Map([["a", 0.9]]),
      }),
    );

    expect(decision.eligible).toBe(false);
    if (decision.eligible) return;
    // Not "nothing found" — the two are different facts and a support question
    // about "why did I get nothing" needs to distinguish them.
    expect(decision.reason).toBe("INTENT_DISABLED");
  });

  it("reports a non-entitled user as NOT_ENTITLED, before looking at candidates", () => {
    const decision = evaluateRegistrationClosing(
      input({
        entitled: false,
        candidates: [candidate("a", "2026-09-19T13:00:00Z")],
        relevanceById: new Map([["a", 0.9]]),
      }),
    );

    expect(decision.eligible).toBe(false);
    if (decision.eligible) return;
    expect(decision.reason).toBe("NOT_ENTITLED");
  });

  it("reports an opted-out user as opted out even when also not entitled", () => {
    const decision = evaluateRegistrationClosing(
      input({ enabled: false, entitled: false }),
    );

    expect(decision.eligible).toBe(false);
    if (decision.eligible) return;
    expect(decision.reason).toBe("INTENT_DISABLED");
  });

  it("stays quiet when nothing closes in the window", () => {
    const decision = evaluateRegistrationClosing(input());

    expect(decision.eligible).toBe(false);
    if (decision.eligible) return;
    expect(decision.reason).toBe("NO_SUBJECTS_IN_WINDOW");
  });

  it("includes a competition the engine ranked", () => {
    const decision = evaluateRegistrationClosing(
      input({
        candidates: [candidate("a", "2026-09-19T13:00:00Z")],
        relevanceById: new Map([["a", 0.8]]),
      }),
    );

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.subjects).toHaveLength(1);
    expect(decision.subjects[0].competitionId).toBe("a");
    expect(decision.subjects[0].score).toBe(0.8);
  });

  it("includes a bookmarked competition the engine never ranked", () => {
    // ND-I-11: relevant OR bookmarked. An explicit save is its own reason to
    // care, and restricting this to relevance would mean staying quiet while
    // something the user deliberately saved expired.
    const decision = evaluateRegistrationClosing(
      input({
        candidates: [candidate("a", "2026-09-19T13:00:00Z")],
        bookmarkedIds: new Set(["a"]),
      }),
    );

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.subjects[0].competitionId).toBe("a");
    // Unranked, so no relevance score. Zero means "not ranked", not "irrelevant".
    expect(decision.subjects[0].score).toBe(0);
  });

  it("excludes a competition the user says they already registered for", () => {
    const decision = evaluateRegistrationClosing(
      input({
        candidates: [candidate("a", "2026-09-19T13:00:00Z")],
        relevanceById: new Map([["a", 0.9]]),
        bookmarkedIds: new Set(["a"]),
        registeredIds: new Set(["a"]),
      }),
    );

    expect(decision.eligible).toBe(false);
    if (decision.eligible) return;
    expect(decision.reason).toBe("NO_RECOMMENDATIONS");
  });

  it("produces one notification when a competition is both relevant and bookmarked", () => {
    // ND-I-12: qualifying twice is a system detail. The user experiences one
    // deadline, so they get one subject, not two.
    const decision = evaluateRegistrationClosing(
      input({
        candidates: [candidate("a", "2026-09-19T13:00:00Z")],
        relevanceById: new Map([["a", 0.9]]),
        bookmarkedIds: new Set(["a"]),
      }),
    );

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.subjects).toHaveLength(1);
  });

  it("excludes a deadline the user has already been told about", () => {
    const deadline = "2026-09-19T13:00:00Z";
    const decision = evaluateRegistrationClosing(
      input({
        candidates: [candidate("a", deadline)],
        relevanceById: new Map([["a", 0.9]]),
        alreadyNotifiedKeys: new Set([occasionKey("a", new Date(deadline))]),
      }),
    );

    expect(decision.eligible).toBe(false);
    if (decision.eligible) return;
    expect(decision.reason).toBe("ALREADY_NOTIFIED");
  });

  it("notifies again when the organizer moves the deadline", () => {
    // ND-H-12. Suppressing forever would mean never warning about the deadline
    // the user can actually act on; ignoring history would re-notify every
    // sweep. Versioning the occasion is what separates the two.
    const original = new Date("2026-09-19T13:00:00Z");
    const moved = "2026-09-26T13:00:00Z";

    const decision = evaluateRegistrationClosing(
      input({
        candidates: [candidate("a", moved)],
        relevanceById: new Map([["a", 0.9]]),
        alreadyNotifiedKeys: new Set([occasionKey("a", original)]),
      }),
    );

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.subjects[0].occasionVersion).toBe(
      String(new Date(moved).getTime()),
    );
  });

  it("aggregates several competitions into one decision", () => {
    // ND-I-13. Deadlines cluster; without aggregation a busy week is the
    // notification storm this subsystem exists to prevent.
    const decision = evaluateRegistrationClosing(
      input({
        candidates: [
          candidate("a", "2026-09-19T13:00:00Z"),
          candidate("b", "2026-09-19T15:00:00Z"),
          candidate("c", "2026-09-19T20:00:00Z"),
        ],
        relevanceById: new Map([
          ["a", 0.5],
          ["b", 0.9],
          ["c", 0.7],
        ]),
      }),
    );

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.subjects).toHaveLength(3);
  });

  it("orders by urgency first, then relevance", () => {
    // The notification is about the clock. A better match closing in three days
    // is less useful today than a weaker one closing tomorrow.
    const decision = evaluateRegistrationClosing(
      input({
        candidates: [
          candidate("later-great", "2026-09-20T13:00:00Z"),
          candidate("sooner-ok", "2026-09-19T13:00:00Z"),
        ],
        relevanceById: new Map([
          ["later-great", 0.99],
          ["sooner-ok", 0.4],
        ]),
      }),
    );

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.subjects.map((s) => s.competitionId)).toEqual([
      "sooner-ok",
      "later-great",
    ]);
  });

  it("breaks a deadline tie by relevance", () => {
    const decision = evaluateRegistrationClosing(
      input({
        candidates: [
          candidate("weak", "2026-09-19T13:00:00Z"),
          candidate("strong", "2026-09-19T13:00:00Z"),
        ],
        relevanceById: new Map([
          ["weak", 0.2],
          ["strong", 0.8],
        ]),
      }),
    );

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.subjects[0].competitionId).toBe("strong");
  });

  it("caps the summary at the configured maximum", () => {
    const decision = evaluateRegistrationClosing(
      input({
        candidates: Array.from({ length: 12 }, (_, i) =>
          candidate(`c${i}`, `2026-09-19T${String(i).padStart(2, "0")}:00:00Z`),
        ),
        relevanceById: new Map(
          Array.from({ length: 12 }, (_, i) => [`c${i}`, 0.5] as const),
        ),
        maxSubjects: 5,
      }),
    );

    expect(decision.eligible).toBe(true);
    if (!decision.eligible) return;
    expect(decision.subjects).toHaveLength(5);
  });

  it("is deterministic for identical inputs", () => {
    const build = () =>
      input({
        candidates: [
          candidate("b", "2026-09-19T13:00:00Z"),
          candidate("a", "2026-09-19T13:00:00Z"),
        ],
        relevanceById: new Map([
          ["a", 0.5],
          ["b", 0.5],
        ]),
      });

    const first = evaluateRegistrationClosing(build());
    const second = evaluateRegistrationClosing(build());

    expect(first).toEqual(second);
  });

  it("never reads the clock for itself", () => {
    // The whole policy is a function of its arguments — which is what lets a
    // retried job reproduce the same decision hours later (ND-D-07).
    const anchored = new Date("2020-01-01T00:00:00Z");
    const decision = evaluateRegistrationClosing(
      input({
        now: anchored,
        candidates: [candidate("a", "2026-09-19T13:00:00Z")],
        relevanceById: new Map([["a", 0.9]]),
      }),
    );

    expect(decision.evaluatedAt).toBe(anchored);
  });
});
