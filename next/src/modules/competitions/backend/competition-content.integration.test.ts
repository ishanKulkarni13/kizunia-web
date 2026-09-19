/**
 * Verifies the `content` nullability contract added to
 * `CompetitionRepository.update` (see the audit's §5a): `undefined` leaves
 * documentation untouched, a string creates/updates the Content row, and
 * `null` explicitly clears it by disconnecting the FK and deleting the
 * now-unowned row — never orphaning it and never touching any other
 * entity's Content row, since every Content row is single-owner by
 * construction (Competition, Project, and CompetitionSuggestion each hold
 * their own `@unique` FK to it).
 *
 * Requires a reachable test database — see docs/testing/database.md. Fails
 * loudly rather than skipping if `DATABASE_TEST_URL` is not configured for
 * a real database, matching this repo's other integration tests.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { CompetitionRepository } from "./repository";

const TEST_SLUG_PREFIX = "__vitest_content_test__";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createTestCompetition(slugSuffix: string) {
  return prisma.competition.create({
    data: {
      title: "Content Nullability Test Competition",
      slug: testSlug(slugSuffix),
    },
  });
}

afterAll(async () => {
  const testCompetitions = await prisma.competition.findMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
    select: { id: true, contentId: true },
  });

  const contentIds = testCompetitions
    .map((c) => c.contentId)
    .filter((id): id is string => id !== null);

  await prisma.competition.deleteMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
  });

  if (contentIds.length > 0) {
    await prisma.content.deleteMany({ where: { id: { in: contentIds } } });
  }

  await prisma.$disconnect();
});

describe("CompetitionRepository.update — content nullability", () => {
  it("creates a Content row when content is a string and none exists yet", async () => {
    const competition = await createTestCompetition("create");

    const updated = await CompetitionRepository.update({
      id: competition.id,
      data: { content: "# Hello" },
    });

    expect(updated.contentId).not.toBeNull();

    const contentRow = await prisma.content.findUnique({
      where: { id: updated.contentId! },
    });
    expect(contentRow?.content).toBe("# Hello");
    expect(contentRow?.version).toBe(1);
  });

  it("updates the existing Content row in place and increments version", async () => {
    const competition = await createTestCompetition("update");

    const first = await CompetitionRepository.update({
      id: competition.id,
      data: { content: "v1" },
    });

    const second = await CompetitionRepository.update({
      id: competition.id,
      data: { content: "v2" },
    });

    expect(second.contentId).toBe(first.contentId);

    const contentRow = await prisma.content.findUnique({
      where: { id: second.contentId! },
    });
    expect(contentRow?.content).toBe("v2");
    expect(contentRow?.version).toBe(2);
  });

  it("leaves content untouched when the key is omitted (undefined)", async () => {
    const competition = await createTestCompetition("omit");

    const withContent = await CompetitionRepository.update({
      id: competition.id,
      data: { content: "keep me" },
    });

    const afterUnrelatedUpdate = await CompetitionRepository.update({
      id: competition.id,
      data: { title: "Renamed Title" },
    });

    expect(afterUnrelatedUpdate.contentId).toBe(withContent.contentId);

    const contentRow = await prisma.content.findUnique({
      where: { id: withContent.contentId! },
    });
    expect(contentRow?.content).toBe("keep me");
    expect(contentRow?.version).toBe(1);
  });

  it("content: null clears contentId AND deletes the Content row (no orphan)", async () => {
    const competition = await createTestCompetition("clear");

    const withContent = await CompetitionRepository.update({
      id: competition.id,
      data: { content: "to be cleared" },
    });
    const contentIdBeforeClear = withContent.contentId;
    expect(contentIdBeforeClear).not.toBeNull();

    const cleared = await CompetitionRepository.update({
      id: competition.id,
      data: { content: null },
    });

    expect(cleared.contentId).toBeNull();

    const orphanCheck = await prisma.content.findUnique({
      where: { id: contentIdBeforeClear! },
    });
    expect(orphanCheck).toBeNull();
  });

  it("content: null on a competition with no Content row is a clean no-op", async () => {
    const competition = await createTestCompetition("noop");

    const result = await CompetitionRepository.update({
      id: competition.id,
      data: { content: null },
    });

    expect(result.contentId).toBeNull();
  });

  it("clearing one competition's content does not affect a Project's Content row", async () => {
    // Guards the "single-owner" claim the whole feature rests on: deleting
    // a competition's Content row must never touch a Project's, even if a
    // real project happens to exist. This creates its own project so it
    // has no dependency on seed data.
    const competition = await createTestCompetition("cross-entity");

    await CompetitionRepository.update({
      id: competition.id,
      data: { content: "competition doc" },
    });

    const project = await prisma.project.create({
      data: {
        title: "Content Nullability Test Project",
        slug: testSlug("project"),
        shortDescription: "Cross-entity Content isolation check.",
        content: { create: { content: "project doc" } },
      },
      select: { id: true, contentId: true },
    });

    await CompetitionRepository.update({
      id: competition.id,
      data: { content: null },
    });

    const projectContent = await prisma.content.findUnique({
      where: { id: project.contentId! },
    });
    expect(projectContent?.content).toBe("project doc");

    // Clean up the project this test created directly (outside the
    // competition-slug-prefixed afterAll sweep).
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.content.delete({ where: { id: project.contentId! } });
  });
});
