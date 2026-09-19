/**
 * Verifies the orthogonality guarantee between `CompetitionBookmark` and
 * `CompetitionRegistration` — all four (bookmarked, registered)
 * combinations are legal, and a write to one table never touches the
 * other — plus the batch-read contract `CompetitionUserStateService`
 * exposes to the list/detail pages.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { CompetitionVisibility } from "@/generated/prisma";
import { CompetitionBookmarkService } from "./competition-bookmark.service";
import { CompetitionRegistrationService } from "./competition-registration.service";
import { CompetitionUserStateService } from "./competition-user-state.service";

const TEST_SLUG_PREFIX = "__vitest_user_state_test__";
const TEST_EMAIL_PREFIX = "__vitest_user_state_test__";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function testEmail(name: string): string {
  return `${TEST_EMAIL_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function createTestCompetition(slugSuffix: string) {
  return prisma.competition.create({
    data: {
      title: "User State Test Competition",
      slug: testSlug(slugSuffix),
      visibility: CompetitionVisibility.PUBLIC,
    },
  });
}

async function createTestUser(nameSuffix: string, banned = false) {
  return prisma.user.create({
    data: {
      id: `user-state-test-${nameSuffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: "User State Test User",
      email: testEmail(nameSuffix),
      emailVerified: true,
      banned,
    },
  });
}

afterAll(async () => {
  await prisma.competitionBookmark.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.competitionRegistration.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.competition.deleteMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("orthogonality — all four combinations are legal", () => {
  it("neither: reports false/false", async () => {
    const competition = await createTestCompetition("neither");
    const user = await createTestUser("neither");

    const [state] = await CompetitionUserStateService.findForCompetitions({
      competitionIds: [competition.id],
      actor: { id: user.id, role: "user", banned: false },
    });

    expect(state).toEqual({
      competitionId: competition.id,
      bookmarked: false,
      registered: false,
    });
  });

  it("bookmarked only", async () => {
    const competition = await createTestCompetition("bookmarked-only");
    const user = await createTestUser("bookmarked-only");

    await CompetitionBookmarkService.add(competition.id, user.id);

    const [state] = await CompetitionUserStateService.findForCompetitions({
      competitionIds: [competition.id],
      actor: { id: user.id, role: "user", banned: false },
    });

    expect(state).toEqual({
      competitionId: competition.id,
      bookmarked: true,
      registered: false,
    });
  });

  it("registered only", async () => {
    const competition = await createTestCompetition("registered-only");
    const user = await createTestUser("registered-only");

    await CompetitionRegistrationService.mark(competition.id, user.id);

    const [state] = await CompetitionUserStateService.findForCompetitions({
      competitionIds: [competition.id],
      actor: { id: user.id, role: "user", banned: false },
    });

    expect(state).toEqual({
      competitionId: competition.id,
      bookmarked: false,
      registered: true,
    });
  });

  it("both", async () => {
    const competition = await createTestCompetition("both");
    const user = await createTestUser("both");

    await CompetitionBookmarkService.add(competition.id, user.id);
    await CompetitionRegistrationService.mark(competition.id, user.id);

    const [state] = await CompetitionUserStateService.findForCompetitions({
      competitionIds: [competition.id],
      actor: { id: user.id, role: "user", banned: false },
    });

    expect(state).toEqual({
      competitionId: competition.id,
      bookmarked: true,
      registered: true,
    });
  });
});

describe("non-interference — a write to one table never touches the other", () => {
  it("adding a bookmark leaves competition_registration untouched", async () => {
    const competition = await createTestCompetition("non-interference-bookmark");
    const user = await createTestUser("non-interference-bookmark");

    await CompetitionRegistrationService.mark(competition.id, user.id);
    const before = await prisma.competitionRegistration.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });

    await CompetitionBookmarkService.add(competition.id, user.id);

    const after = await prisma.competitionRegistration.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(after.markedAt).toEqual(before.markedAt);

    const registrationCount = await prisma.competitionRegistration.count({
      where: { competitionId: competition.id, userId: user.id },
    });
    expect(registrationCount).toBe(1);
  });

  it("adding a registration leaves competition_bookmark untouched", async () => {
    const competition = await createTestCompetition("non-interference-registration");
    const user = await createTestUser("non-interference-registration");

    await CompetitionBookmarkService.add(competition.id, user.id);
    const before = await prisma.competitionBookmark.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });

    await CompetitionRegistrationService.mark(competition.id, user.id);

    const after = await prisma.competitionBookmark.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(after.createdAt).toEqual(before.createdAt);

    const bookmarkCount = await prisma.competitionBookmark.count({
      where: { competitionId: competition.id, userId: user.id },
    });
    expect(bookmarkCount).toBe(1);
  });

  it("removing a bookmark does not remove an existing registration", async () => {
    const competition = await createTestCompetition("removal-independence");
    const user = await createTestUser("removal-independence");

    await CompetitionBookmarkService.add(competition.id, user.id);
    await CompetitionRegistrationService.mark(competition.id, user.id);

    await CompetitionBookmarkService.remove(competition.id, user.id);

    const registration = await prisma.competitionRegistration.findUnique({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(registration).not.toBeNull();
  });
});

describe("CompetitionUserStateService.findForCompetitions — batch read contract", () => {
  it("returns one entry per requested id, including ids with neither state", async () => {
    const competitionA = await createTestCompetition("batch-a");
    const competitionB = await createTestCompetition("batch-b");
    const user = await createTestUser("batch");

    await CompetitionBookmarkService.add(competitionA.id, user.id);

    const states = await CompetitionUserStateService.findForCompetitions({
      competitionIds: [competitionA.id, competitionB.id],
      actor: { id: user.id, role: "user", banned: false },
    });

    expect(states).toHaveLength(2);
    expect(states.find((s) => s.competitionId === competitionA.id)?.bookmarked).toBe(
      true,
    );
    expect(states.find((s) => s.competitionId === competitionB.id)?.bookmarked).toBe(
      false,
    );
  });

  it("returns an empty-state answer for a null actor", async () => {
    const competition = await createTestCompetition("anonymous");

    const states = await CompetitionUserStateService.findForCompetitions({
      competitionIds: [competition.id],
      actor: null,
    });

    expect(states).toEqual([
      { competitionId: competition.id, bookmarked: false, registered: false },
    ]);
  });

  it("returns an empty-state answer for a banned actor, without touching their real rows", async () => {
    const competition = await createTestCompetition("banned");
    const user = await createTestUser("banned", true);

    await CompetitionBookmarkService.add(competition.id, user.id);

    const states = await CompetitionUserStateService.findForCompetitions({
      competitionIds: [competition.id],
      actor: { id: user.id, role: "user", banned: true },
    });

    expect(states).toEqual([
      { competitionId: competition.id, bookmarked: false, registered: false },
    ]);

    // The underlying row is untouched — banning freezes writes, it does
    // not erase existing state.
    const row = await prisma.competitionBookmark.findUnique({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(row).not.toBeNull();
  });

  it("never leaks a second user's state into the first user's response", async () => {
    const competition = await createTestCompetition("isolation");
    const userA = await createTestUser("isolation-a");
    const userB = await createTestUser("isolation-b");

    await CompetitionBookmarkService.add(competition.id, userB.id);

    const statesForA = await CompetitionUserStateService.findForCompetitions({
      competitionIds: [competition.id],
      actor: { id: userA.id, role: "user", banned: false },
    });

    expect(statesForA[0].bookmarked).toBe(false);
  });
});
