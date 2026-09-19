/**
 * Verifies the "never auto-removed" guarantee for `CompetitionBookmark`:
 * a bookmark survives every `CompetitionStatus` transition and a soft
 * delete, is idempotent to add, and is unconditionally removable.
 *
 * Requires a reachable test database — see docs/testing/database.md. Fails
 * loudly rather than skipping if `DATABASE_TEST_URL` is not configured for
 * a real database, matching this repo's other integration tests.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { CompetitionStatus, CompetitionVisibility } from "@/generated/prisma";
import { CompetitionBookmarkRepository } from "./competition-bookmark.repository";
import { CompetitionBookmarkService } from "./competition-bookmark.service";

const TEST_SLUG_PREFIX = "__vitest_bookmark_test__";
const TEST_EMAIL_PREFIX = "__vitest_bookmark_test__";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function testEmail(name: string): string {
  return `${TEST_EMAIL_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function createTestCompetition(
  slugSuffix: string,
  overrides: {
    status?: CompetitionStatus | null;
    visibility?: CompetitionVisibility;
    deletedAt?: Date | null;
  } = {},
) {
  return prisma.competition.create({
    data: {
      title: "Bookmark Test Competition",
      slug: testSlug(slugSuffix),
      visibility: overrides.visibility ?? CompetitionVisibility.PUBLIC,
      status: overrides.status ?? null,
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

async function createTestUser(nameSuffix: string) {
  return prisma.user.create({
    data: {
      id: `bookmark-test-${nameSuffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: "Bookmark Test User",
      email: testEmail(nameSuffix),
      emailVerified: true,
    },
  });
}

afterAll(async () => {
  await prisma.competitionBookmark.deleteMany({
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

describe("CompetitionBookmarkRepository — idempotency", () => {
  it("upserting twice leaves exactly one row and does not change createdAt", async () => {
    const competition = await createTestCompetition("idempotent");
    const user = await createTestUser("idempotent");

    await CompetitionBookmarkRepository.upsert(competition.id, user.id);
    const first = await prisma.competitionBookmark.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });

    await CompetitionBookmarkRepository.upsert(competition.id, user.id);
    const second = await prisma.competitionBookmark.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });

    expect(second.createdAt).toEqual(first.createdAt);

    const count = await prisma.competitionBookmark.count({
      where: { competitionId: competition.id, userId: user.id },
    });
    expect(count).toBe(1);
  });

  it("deleteMany on a non-existent bookmark returns 0 and does not throw", async () => {
    const competition = await createTestCompetition("delete-noop");
    const user = await createTestUser("delete-noop");

    const result = await CompetitionBookmarkRepository.deleteMany(
      competition.id,
      user.id,
    );

    expect(result).toBe(0);
  });

  it("remove then re-add produces a new createdAt", async () => {
    const competition = await createTestCompetition("re-add");
    const user = await createTestUser("re-add");

    await CompetitionBookmarkRepository.upsert(competition.id, user.id);
    const first = await prisma.competitionBookmark.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });

    await CompetitionBookmarkRepository.deleteMany(competition.id, user.id);

    // Ensure a measurable time gap so createdAt cannot coincidentally match.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await CompetitionBookmarkRepository.upsert(competition.id, user.id);
    const second = await prisma.competitionBookmark.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });

    expect(second.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
  });
});

describe("CompetitionBookmarkService — never auto-removed by lifecycle", () => {
  it.each([
    CompetitionStatus.REGISTRATION_CLOSED,
    CompetitionStatus.ONGOING,
    CompetitionStatus.COMPLETED,
    CompetitionStatus.CANCELLED,
  ])(
    "a bookmark survives a transition to %s",
    async (status) => {
      const competition = await createTestCompetition(`lifecycle-${status}`);
      const user = await createTestUser(`lifecycle-${status}`);

      await CompetitionBookmarkService.add(competition.id, user.id);

      // Simulate the lifecycle sweep/admin apply changing status directly —
      // it must never cascade into removing the bookmark, because nothing
      // in that path calls CompetitionBookmarkService or its repository.
      await prisma.competition.update({
        where: { id: competition.id },
        data: { status, statusUpdatedAt: new Date() },
      });

      const stillBookmarked = await prisma.competitionBookmark.findUnique({
        where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
      });

      expect(stillBookmarked).not.toBeNull();
    },
  );

  it("survives a soft delete and is still removable afterwards", async () => {
    const competition = await createTestCompetition("soft-delete");
    const user = await createTestUser("soft-delete");

    await CompetitionBookmarkService.add(competition.id, user.id);

    await prisma.competition.update({
      where: { id: competition.id },
      data: { deletedAt: new Date() },
    });

    const stillBookmarked = await prisma.competitionBookmark.findUnique({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(stillBookmarked).not.toBeNull();

    // Removal must remain unconditional even for an archived/deleted row.
    await CompetitionBookmarkService.remove(competition.id, user.id);

    const afterRemove = await prisma.competitionBookmark.findUnique({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(afterRemove).toBeNull();
  });

  it("hard-deleting the competition cascades the bookmark away", async () => {
    const competition = await createTestCompetition("cascade-competition");
    const user = await createTestUser("cascade-competition");

    await CompetitionBookmarkService.add(competition.id, user.id);
    await prisma.competition.delete({ where: { id: competition.id } });

    const afterCascade = await prisma.competitionBookmark.findUnique({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(afterCascade).toBeNull();
  });

  it("deleting the user cascades the bookmark away", async () => {
    const competition = await createTestCompetition("cascade-user");
    const user = await createTestUser("cascade-user");

    await CompetitionBookmarkService.add(competition.id, user.id);
    await prisma.user.delete({ where: { id: user.id } });

    const afterCascade = await prisma.competitionBookmark.findUnique({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(afterCascade).toBeNull();
  });
});
