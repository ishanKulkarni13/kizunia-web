/**
 * Verifies the "never auto-removed" guarantee for `CompetitionRegistration`,
 * plus the decision that marking as registered is allowed at every
 * `CompetitionStatus` — there is deliberately no "registration is closed"
 * guard. See `CompetitionRegistrationService`'s docblock.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { CompetitionStatus, CompetitionVisibility } from "@/generated/prisma";
import { CompetitionRegistrationRepository } from "./competition-registration.repository";
import { CompetitionRegistrationService } from "./competition-registration.service";

const TEST_SLUG_PREFIX = "__vitest_registration_test__";
const TEST_EMAIL_PREFIX = "__vitest_registration_test__";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function testEmail(name: string): string {
  return `${TEST_EMAIL_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function createTestCompetition(
  slugSuffix: string,
  overrides: { status?: CompetitionStatus | null } = {},
) {
  return prisma.competition.create({
    data: {
      title: "Registration Test Competition",
      slug: testSlug(slugSuffix),
      visibility: CompetitionVisibility.PUBLIC,
      status: overrides.status ?? null,
    },
  });
}

async function createTestUser(nameSuffix: string) {
  return prisma.user.create({
    data: {
      id: `registration-test-${nameSuffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: "Registration Test User",
      email: testEmail(nameSuffix),
      emailVerified: true,
    },
  });
}

afterAll(async () => {
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

describe("CompetitionRegistrationRepository — idempotency", () => {
  it("upserting twice leaves exactly one row and does not change markedAt", async () => {
    const competition = await createTestCompetition("idempotent");
    const user = await createTestUser("idempotent");

    await CompetitionRegistrationRepository.upsert(competition.id, user.id);
    const first = await prisma.competitionRegistration.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });

    await CompetitionRegistrationRepository.upsert(competition.id, user.id);
    const second = await prisma.competitionRegistration.findUniqueOrThrow({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });

    expect(second.markedAt).toEqual(first.markedAt);

    const count = await prisma.competitionRegistration.count({
      where: { competitionId: competition.id, userId: user.id },
    });
    expect(count).toBe(1);
  });

  it("deleteMany on a non-existent registration returns 0 and does not throw", async () => {
    const competition = await createTestCompetition("delete-noop");
    const user = await createTestUser("delete-noop");

    const result = await CompetitionRegistrationRepository.deleteMany(
      competition.id,
      user.id,
    );

    expect(result).toBe(0);
  });
});

describe("CompetitionRegistrationService — allowed at every status", () => {
  it.each([
    CompetitionStatus.UPCOMING,
    CompetitionStatus.REGISTRATION_OPEN,
    CompetitionStatus.REGISTRATION_CLOSED,
    CompetitionStatus.ONGOING,
    CompetitionStatus.COMPLETED,
    CompetitionStatus.CANCELLED,
  ])(
    "mark succeeds when status is %s",
    async (status) => {
      const competition = await createTestCompetition(`status-${status}`, {
        status,
      });
      const user = await createTestUser(`status-${status}`);

      await expect(
        CompetitionRegistrationService.mark(competition.id, user.id),
      ).resolves.not.toThrow();

      const row = await prisma.competitionRegistration.findUnique({
        where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
      });
      expect(row).not.toBeNull();
    },
  );
});

describe("CompetitionRegistrationService — never auto-removed by lifecycle", () => {
  it.each([
    CompetitionStatus.REGISTRATION_CLOSED,
    CompetitionStatus.ONGOING,
    CompetitionStatus.COMPLETED,
    CompetitionStatus.CANCELLED,
  ])(
    "a registration mark survives a transition to %s",
    async (status) => {
      const competition = await createTestCompetition(`lifecycle-${status}`);
      const user = await createTestUser(`lifecycle-${status}`);

      await CompetitionRegistrationService.mark(competition.id, user.id);

      await prisma.competition.update({
        where: { id: competition.id },
        data: { status, statusUpdatedAt: new Date() },
      });

      const stillMarked = await prisma.competitionRegistration.findUnique({
        where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
      });

      expect(stillMarked).not.toBeNull();
    },
  );

  it("hard-deleting the competition cascades the registration away", async () => {
    const competition = await createTestCompetition("cascade-competition");
    const user = await createTestUser("cascade-competition");

    await CompetitionRegistrationService.mark(competition.id, user.id);
    await prisma.competition.delete({ where: { id: competition.id } });

    const afterCascade = await prisma.competitionRegistration.findUnique({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(afterCascade).toBeNull();
  });

  it("deleting the user cascades the registration away", async () => {
    const competition = await createTestCompetition("cascade-user");
    const user = await createTestUser("cascade-user");

    await CompetitionRegistrationService.mark(competition.id, user.id);
    await prisma.user.delete({ where: { id: user.id } });

    const afterCascade = await prisma.competitionRegistration.findUnique({
      where: { competitionId_userId: { competitionId: competition.id, userId: user.id } },
    });
    expect(afterCascade).toBeNull();
  });
});
