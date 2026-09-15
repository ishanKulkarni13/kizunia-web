import { describe, expect, it } from "vitest";
import type { CompetitionEditDTOWithPermissions } from "../types/edit-dto";
import { buildUpdateCompetitionPayload } from "./build-update-payload";

function makeCompetition(
  overrides: Partial<CompetitionEditDTOWithPermissions> = {},
): CompetitionEditDTOWithPermissions {
  return {
    id: "c1",
    title: "International Hackathon 2026",
    slug: "international-hackathon-2026",
    shortDescription: null,
    organizer: null,
    content: null,
    website: null,
    registrationLink: "https://example.com/register",
    registrationPlatform: null,
    registrationFee: null,
    registrationFeeType: null,
    mode: null,
    visibility: "PRIVATE" as CompetitionEditDTOWithPermissions["visibility"],
    status: null,
    organizerType: null,
    difficulty: null,
    certificateType: null,
    prizePool: null,
    locations: [],
    registrationDeadline: null,
    startDate: null,
    endDate: null,
    registrationStartDate: null,
    automaticStatusUpdatesDisabled: false,
    statusUpdatedAt: null,
    minTeamSize: null,
    maxTeamSize: null,
    logoAsset: null,
    coverAsset: null,
    bannerAsset: null,
    categories: [],
    technologies: [],
    eligibilities: [],
    role: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    permissions: {
      canView: true,
      canEdit: true,
      canDelete: true,
      canPublish: true,
      canUnpublish: true,
      canManageMembers: true,
      canManageMedia: true,
      canManageLinks: true,
      canManageTechnologies: true,
      canManageEligibility: true,
    },
    ...overrides,
  };
}

describe("buildUpdateCompetitionPayload", () => {
  it("returns an empty object when nothing changed", () => {
    const saved = makeCompetition();
    const current = makeCompetition();
    expect(buildUpdateCompetitionPayload(current, saved)).toEqual({});
  });

  it("omits a field that was typed and then reverted to the saved value", () => {
    const saved = makeCompetition({ title: "Original Title" });
    const current = makeCompetition({ title: "Original Title" });
    const payload = buildUpdateCompetitionPayload(current, saved);
    expect(payload).not.toHaveProperty("title");
  });

  it("emits an explicit null for a cleared nullable field, not an omission", () => {
    const saved = makeCompetition({
      registrationLink: "https://example.com/register",
    });
    const current = makeCompetition({ registrationLink: null });

    const payload = buildUpdateCompetitionPayload(current, saved);

    expect(payload).toHaveProperty("registrationLink");
    expect(payload.registrationLink).toBeNull();
  });

  it("omits every field that was never touched", () => {
    const saved = makeCompetition();
    const current = makeCompetition({ mode: "ONLINE" as never });

    const payload = buildUpdateCompetitionPayload(current, saved);

    expect(Object.keys(payload)).toEqual(["mode"]);
  });

  it("includes slug when it changed", () => {
    const saved = makeCompetition({ slug: "old-slug" });
    const current = makeCompetition({ slug: "new-slug" });

    const payload = buildUpdateCompetitionPayload(current, saved);

    expect(payload.slug).toBe("new-slug");
  });

  it("includes status only when it changed", () => {
    const saved = makeCompetition({ status: null });
    const unchangedStatus = makeCompetition({ status: null, title: "New" });
    expect(
      buildUpdateCompetitionPayload(unchangedStatus, saved),
    ).not.toHaveProperty("status");

    const changedStatus = makeCompetition({
      status: "UPCOMING" as never,
    });
    expect(buildUpdateCompetitionPayload(changedStatus, saved)).toHaveProperty(
      "status",
      "UPCOMING",
    );
  });

  it("never includes locations, technologies, or eligibilities (managed by their own endpoints)", () => {
    const saved = makeCompetition();
    const current = makeCompetition({
      technologies: [
        { id: "t1", name: "React", slug: "react", type: "LIBRARY" as never, iconAsset: null },
      ],
      eligibilities: [{ type: "OPEN" as never }],
    });

    const payload = buildUpdateCompetitionPayload(current, saved);

    expect(payload).not.toHaveProperty("technologies");
    expect(payload).not.toHaveProperty("locations");
    expect(payload).not.toHaveProperty("eligibilities");
  });

  it("supports an all-null-optional-fields competition producing no blockers by itself", () => {
    // Mirrors the brief's core scenario: mode/teamSize/prize/certificate all
    // null is a valid, saveable diff shape — this function does not reject
    // or flag it.
    const saved = makeCompetition();
    const current = makeCompetition({
      mode: null,
      minTeamSize: null,
      maxTeamSize: null,
      certificateType: null,
      prizePool: null,
    });
    expect(buildUpdateCompetitionPayload(current, saved)).toEqual({});
  });
});
