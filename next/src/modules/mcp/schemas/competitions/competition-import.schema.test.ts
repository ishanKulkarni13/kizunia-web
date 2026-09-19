import { describe, expect, it } from "vitest";

import { CompetitionImportSchema } from "./competition-import.schema";

describe("CompetitionImportSchema", () => {
  it("accepts the minimal payload (title only)", () => {
    const result = CompetitionImportSchema.safeParse({ title: "Hack the Future" });

    expect(result.success).toBe(true);
  });

  it("accepts a fully populated payload", () => {
    const result = CompetitionImportSchema.safeParse({
      title: "Hack the Future",
      slug: "hack-the-future",
      shortDescription: "A 48-hour hackathon",
      organizer: "Acme Corp",
      organizerType: "COMPANY",
      website: "https://acme.example",
      registrationLink: "https://acme.example/register",
      registrationPlatform: "DEVPOST",
      registrationFeeType: "FREE",
      registrationFee: "0",
      prizePool: "$10,000",
      mode: "ONLINE",
      difficulty: "INTERMEDIATE",
      certificateType: "PARTICIPATION",
      minTeamSize: 1,
      maxTeamSize: 4,
      startDate: "2026-03-01T00:00:00Z",
      endDate: "2026-03-03T00:00:00Z",
      registrationStartDate: "2026-01-01T00:00:00Z",
      registrationDeadline: "2026-02-28T00:00:00Z",
      content: "# About this hackathon",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a title shorter than 3 characters", () => {
    const result = CompetitionImportSchema.safeParse({ title: "Hi" });

    expect(result.success).toBe(false);
  });

  it("rejects a malformed slug", () => {
    const result = CompetitionImportSchema.safeParse({
      title: "Hack the Future",
      slug: "Not A Valid Slug!",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-URL website", () => {
    const result = CompetitionImportSchema.safeParse({
      title: "Hack the Future",
      website: "not-a-url",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid enum value", () => {
    const result = CompetitionImportSchema.safeParse({
      title: "Hack the Future",
      mode: "IN_PERSON", // not a real CompetitionMode value
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO date string", () => {
    const result = CompetitionImportSchema.safeParse({
      title: "Hack the Future",
      startDate: "March 1st 2026",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unrecognised field being silently dropped is NOT the behaviour — extra keys are stripped, not rejected, matching Zod's default object parsing", () => {
    const result = CompetitionImportSchema.safeParse({
      title: "Hack the Future",
      // Mass-assignment attempt: fields that do not exist on the schema at all.
      role: "SUPER_ADMIN",
      createdById: "someone-elses-id",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data).not.toHaveProperty("role");
      expect(result.data).not.toHaveProperty("createdById");
    }
  });

  it("rejects a negative team size", () => {
    const result = CompetitionImportSchema.safeParse({
      title: "Hack the Future",
      minTeamSize: -1,
    });

    expect(result.success).toBe(false);
  });
});
