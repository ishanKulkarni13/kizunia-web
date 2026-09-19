import { describe, expect, it } from "vitest";

import {
  CompetitionUserStateQuerySchema,
  MAX_COMPETITION_USER_STATE_IDS,
} from "./competition-user-state";

const CUID_A = "clh3am1x40000356h8j2j2j2j";
const CUID_B = "clh3am1x40001356h8j2j2j2k";

describe("CompetitionUserStateQuerySchema", () => {
  it("splits a comma-separated list of ids", () => {
    const result = CompetitionUserStateQuerySchema.parse({
      competitionIds: `${CUID_A},${CUID_B}`,
    });

    expect(result.competitionIds).toEqual([CUID_A, CUID_B]);
  });

  it("trims whitespace around each id", () => {
    const result = CompetitionUserStateQuerySchema.parse({
      competitionIds: ` ${CUID_A} , ${CUID_B} `,
    });

    expect(result.competitionIds).toEqual([CUID_A, CUID_B]);
  });

  it("drops empty segments from a trailing/leading/double comma", () => {
    const result = CompetitionUserStateQuerySchema.parse({
      competitionIds: `${CUID_A},,${CUID_B},`,
    });

    expect(result.competitionIds).toEqual([CUID_A, CUID_B]);
  });

  it("rejects a non-cuid id", () => {
    expect(() =>
      CompetitionUserStateQuerySchema.parse({
        competitionIds: "not-a-cuid",
      }),
    ).toThrow();
  });

  it("rejects an empty list", () => {
    expect(() =>
      CompetitionUserStateQuerySchema.parse({ competitionIds: "" }),
    ).toThrow();
  });

  it(`rejects more than ${MAX_COMPETITION_USER_STATE_IDS} ids`, () => {
    const tooMany = Array.from(
      { length: MAX_COMPETITION_USER_STATE_IDS + 1 },
      () => CUID_A,
    ).join(",");

    expect(() =>
      CompetitionUserStateQuerySchema.parse({ competitionIds: tooMany }),
    ).toThrow();
  });

  it(`accepts exactly ${MAX_COMPETITION_USER_STATE_IDS} ids`, () => {
    const exactly = Array.from(
      { length: MAX_COMPETITION_USER_STATE_IDS },
      () => CUID_A,
    ).join(",");

    expect(() =>
      CompetitionUserStateQuerySchema.parse({ competitionIds: exactly }),
    ).not.toThrow();
  });
});
