/**
 * Verifies the Portfolio public-visibility model end to end against a real
 * database:
 *
 * - `visibility` (the owner's stored preference) is never mutated by
 *   entitlement state, in either direction.
 * - Public display additionally requires `resolvePortfolioPublicEligibility`
 *   (the future-entitlement seam) to be true — mocked here to simulate an
 *   inactive entitlement, since the real implementation always returns true
 *   today.
 * - The owner can always view/edit their own portfolio regardless of
 *   eligibility.
 * - Losing then regaining eligibility restores public display automatically
 *   from the existing stored `visibility`, with no other write.
 *
 * Requires a reachable test database — see docs/testing/database.md. Fails
 * loudly rather than skipping if `DATABASE_TEST_URL` is not configured,
 * matching this repo's other integration tests.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const { mockEligibility } = vi.hoisted(() => ({
  mockEligibility: vi.fn(() => true),
}));

vi.mock("@/modules/portfolio/backend/authorization/public-eligibility", () => ({
  resolvePortfolioPublicEligibility: mockEligibility,
}));

import prisma from "@/lib/prisma";
import { PortfolioVisibility } from "@/generated/prisma";
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import { portfolioService } from "./service";
import { PortfolioNotFoundError } from "../errors";

const TEST_PREFIX = "__vitest_portfolio_visibility__";

function testUsername(name: string): string {
  return `${TEST_PREFIX}_${name}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function testEmail(name: string): string {
  return `${TEST_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function createTestUser({
  name,
  banned = false,
}: {
  name: string;
  banned?: boolean;
}) {
  const username = testUsername(name);

  return prisma.user.create({
    data: {
      id: `portfolio-vis-test-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: "Portfolio Visibility Test User",
      email: testEmail(name),
      emailVerified: true,
      username,
      banned,
    },
  });
}

async function createTestPortfolio({
  userId,
  visibility = PortfolioVisibility.PUBLIC,
  deletedAt = null,
}: {
  userId: string;
  visibility?: PortfolioVisibility;
  deletedAt?: Date | null;
}) {
  return prisma.portfolio.create({
    data: {
      displayName: "Portfolio Visibility Test",
      userId,
      visibility,
      deletedAt,
    },
  });
}

function actorFor(userId: string): StrictAuthorizationActor {
  return { id: userId, role: PlatformRole.USER, banned: false };
}

afterEach(() => {
  mockEligibility.mockReturnValue(true);
});

afterAll(async () => {
  await prisma.portfolio.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("PortfolioService.findPublicByUsername — visibility model", () => {
  it("returns a PUBLIC, eligible portfolio", async () => {
    const user = await createTestUser({ name: "public-eligible" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

    const dto = await portfolioService.findPublicByUsername({ username: user.username! });

    expect(dto.user.username).toBe(user.username);
  });

  it("hides a PUBLIC portfolio when public-display eligibility is inactive, without touching the stored preference", async () => {
    const user = await createTestUser({ name: "public-ineligible" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

    mockEligibility.mockReturnValue(false);

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);

    // Non-destructive guarantee: the owner's stored preference is untouched
    // by the entitlement denial — re-read from the database, not memory.
    const row = await prisma.portfolio.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.visibility).toBe(PortfolioVisibility.PUBLIC);
  });

  it("hides a PRIVATE portfolio regardless of eligibility", async () => {
    const user = await createTestUser({ name: "private" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PRIVATE });

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });

  it("lets the owner keep viewing and editing while ineligible for public display", async () => {
    const user = await createTestUser({ name: "owner-ineligible" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

    mockEligibility.mockReturnValue(false);

    const actor = actorFor(user.id);

    const mine = await portfolioService.findMine({ actor });
    expect(mine).not.toBeNull();

    const updated = await portfolioService.updateProfile({
      actor,
      dto: { headline: "Still editable while ineligible" },
    });
    expect(updated.headline).toBe("Still editable while ineligible");
  });

  it("restores public display automatically when eligibility becomes active again, with no other write", async () => {
    const user = await createTestUser({ name: "restore" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

    mockEligibility.mockReturnValue(false);
    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);

    mockEligibility.mockReturnValue(true);

    const dto = await portfolioService.findPublicByUsername({ username: user.username! });
    expect(dto.user.username).toBe(user.username);
  });

  it("hides a portfolio whose owner is banned, even when PUBLIC and eligible", async () => {
    const user = await createTestUser({ name: "owner-banned", banned: true });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });

  it("hides a soft-deleted portfolio", async () => {
    const user = await createTestUser({ name: "deleted" });
    await createTestPortfolio({
      userId: user.id,
      visibility: PortfolioVisibility.PUBLIC,
      deletedAt: new Date(),
    });

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });
});
