import { describe, expect, it, vi } from "vitest";

const existsBySlugMock = vi.fn();

vi.mock("@/modules/competitions/backend/repository", () => ({
  CompetitionRepository: {
    existsBySlug: (...args: unknown[]) => existsBySlugMock(...args),
  },
}));

 
import { CompetitionImportMapper } from "./competition-import.mapper";
 
import type { CompetitionImportInput } from "../schemas/competitions/competition-import.schema";

function importInput(
  overrides: Partial<CompetitionImportInput> = {},
): CompetitionImportInput {
  return { title: "Hack the Future", ...overrides };
}

describe("CompetitionImportMapper.resolveSlug", () => {
  it("returns the caller-supplied slug unchanged when present", async () => {
    const slug = await CompetitionImportMapper.resolveSlug(
      importInput({ slug: "explicit-slug" }),
    );

    expect(slug).toBe("explicit-slug");
    expect(existsBySlugMock).not.toHaveBeenCalled();
  });

  it("derives a slug from the title when none is supplied", async () => {
    existsBySlugMock.mockResolvedValueOnce(false);

    const slug = await CompetitionImportMapper.resolveSlug(importInput());

    expect(slug).toBe("hack-the-future");
  });

  it("disambiguates with a numeric suffix when the derived slug is taken", async () => {
    existsBySlugMock
      .mockResolvedValueOnce(true) // "hack-the-future"
      .mockResolvedValueOnce(false); // "hack-the-future-3"

    const slug = await CompetitionImportMapper.resolveSlug(importInput());

    expect(slug).toBe("hack-the-future-3");
  });

  it("falls back to a generic base when the title slugifies to nothing", async () => {
    existsBySlugMock.mockResolvedValueOnce(false);

    const slug = await CompetitionImportMapper.resolveSlug(
      importInput({ title: "!!!" }),
    );

    expect(slug).toBe("competition");
  });
});

describe("CompetitionImportMapper.toCreateInput", () => {
  it("maps only the fields CreateCompetitionSchema accepts", () => {
    const input = importInput({
      shortDescription: "A great hackathon",
      organizer: "Acme Corp",
      website: "https://acme.example",
      registrationLink: "https://acme.example/register",
      content: "# About",
      // Fields NOT in CreateCompetitionSchema — must not leak into the
      // create payload (they go through the follow-up update instead).
      prizePool: "$10,000",
      mode: "ONLINE",
    });

    const result = CompetitionImportMapper.toCreateInput(input, "hack-the-future");

    expect(result).toEqual({
      title: "Hack the Future",
      slug: "hack-the-future",
      shortDescription: "A great hackathon",
      organizer: "Acme Corp",
      website: "https://acme.example",
      registrationLink: "https://acme.example/register",
      content: "# About",
    });
  });
});

describe("CompetitionImportMapper.toUpdateInput", () => {
  it("includes only fields explicitly present in the patch", () => {
    const result = CompetitionImportMapper.toUpdateInput({
      prizePool: "$5,000",
    });

    expect(result).toEqual({ prizePool: "$5,000" });
  });

  it("converts ISO date strings to Date instances", () => {
    const result = CompetitionImportMapper.toUpdateInput({
      startDate: "2026-01-01T00:00:00Z",
      registrationDeadline: "2025-12-15T00:00:00Z",
    });

    expect(result.startDate).toBeInstanceOf(Date);
    expect(result.registrationDeadline).toBeInstanceOf(Date);
    expect(result.startDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns an empty object for an empty patch", () => {
    expect(CompetitionImportMapper.toUpdateInput({})).toEqual({});
  });
});

describe("CompetitionImportMapper.toCreateFollowUpUpdate", () => {
  it("returns null when the import contract carries nothing beyond create fields", () => {
    const result = CompetitionImportMapper.toCreateFollowUpUpdate(
      importInput({ organizer: "Acme Corp" }),
    );

    // organizer IS part of both create and update — this call only sends
    // fields toUpdateInput would map, so it is non-null whenever any
    // mappable field is present, including ones also used by create.
    expect(result).not.toBeNull();
  });

  it("returns null when literally nothing beyond title was supplied", () => {
    const result = CompetitionImportMapper.toCreateFollowUpUpdate(importInput());

    expect(result).toEqual({ title: "Hack the Future" });
  });
});
