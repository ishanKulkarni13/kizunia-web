import { describe, expect, it } from "vitest";
import { rankCandidates } from "./ranking";
import { buildCandidate } from "./test-helpers";

describe("rankCandidates", () => {
  it("orders by score, descending", () => {
    const ranked = rankCandidates([
      { candidate: buildCandidate({ id: "low" }), score: 0.2 },
      { candidate: buildCandidate({ id: "high" }), score: 0.9 },
      { candidate: buildCandidate({ id: "mid" }), score: 0.5 },
    ]);

    expect(ranked.map((r) => r.candidate.id)).toEqual(["high", "mid", "low"]);
  });

  it("breaks a score tie by registrationDeadline ascending", () => {
    const soon = buildCandidate({
      id: "soon",
      registrationDeadline: new Date("2026-10-01"),
    });
    const later = buildCandidate({
      id: "later",
      registrationDeadline: new Date("2026-11-01"),
    });

    const ranked = rankCandidates([
      { candidate: later, score: 0.6 },
      { candidate: soon, score: 0.6 },
    ]);

    expect(ranked.map((r) => r.candidate.id)).toEqual(["soon", "later"]);
  });

  it("puts a null registrationDeadline last among tied scores", () => {
    const withDeadline = buildCandidate({
      id: "with-deadline",
      registrationDeadline: new Date("2026-10-01"),
    });
    const withoutDeadline = buildCandidate({ id: "without-deadline", registrationDeadline: null });

    const ranked = rankCandidates([
      { candidate: withoutDeadline, score: 0.6 },
      { candidate: withDeadline, score: 0.6 },
    ]);

    expect(ranked.map((r) => r.candidate.id)).toEqual(["with-deadline", "without-deadline"]);
  });

  it("falls through to startDate, then to id, for a fully tied pair", () => {
    const a = buildCandidate({ id: "a", registrationDeadline: null, startDate: null });
    const b = buildCandidate({ id: "b", registrationDeadline: null, startDate: null });

    const ranked = rankCandidates([
      { candidate: b, score: 0.6 },
      { candidate: a, score: 0.6 },
    ]);

    // Deterministic: "a" < "b" lexicographically, and this ordering must be
    // stable across runs — no randomness anywhere in this module.
    expect(ranked.map((r) => r.candidate.id)).toEqual(["a", "b"]);
  });

  it("never treats two distinct candidates as equal, however many fields tie", () => {
    const a = buildCandidate({ id: "a", registrationDeadline: null, startDate: null });
    const b = buildCandidate({ id: "b", registrationDeadline: null, startDate: null });

    const first = rankCandidates([
      { candidate: a, score: 0.5 },
      { candidate: b, score: 0.5 },
    ]);
    const second = rankCandidates([
      { candidate: b, score: 0.5 },
      { candidate: a, score: 0.5 },
    ]);

    expect(first.map((r) => r.candidate.id)).toEqual(second.map((r) => r.candidate.id));
  });
});
