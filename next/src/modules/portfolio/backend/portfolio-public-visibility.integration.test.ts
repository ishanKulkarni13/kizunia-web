/**
 * Verifies the Portfolio public-visibility model end to end against a real
 * database:
 *
 * - `visibility` (the owner's stored preference) is never mutated by
 *   entitlement state, in either direction.
 * - Public display additionally requires the OWNER's effective access to
 *   include the portfolio capability (IB-5) — driven here by real grants,
 *   through the real resolver, not a mock.
 * - The owner can always view/edit their own portfolio regardless of
 *   eligibility.
 * - Losing then regaining access restores public display automatically from
 *   the existing stored `visibility`, with no other write.
 * - Eligibility follows the owner's access, never their platform role.
 *
 * Requires a reachable test database — see docs/testing/database.md. Fails
 * loudly rather than skipping if `DATABASE_TEST_URL` is not configured,
 * matching this repo's other integration tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { PortfolioVisibility } from "@/generated/prisma";
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import {
  deleteGrantsForEmailPrefix,
  insertGrant,
  revokeGrants,
} from "@/testing/entitlement-fixtures";
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
  role,
}: {
  name: string;
  banned?: boolean;
  role?: string;
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
      ...(role && { role }),
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

let granterId: string;

/** The real gate, via a real grant. */
async function grantPro(userId: string) {
  return insertGrant(userId, granterId, { plan: "PRO" });
}

beforeAll(async () => {
  const granter = await createTestUser({ name: "granter" });
  granterId = granter.id;
});

afterAll(async () => {
  await prisma.portfolio.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await deleteGrantsForEmailPrefix(TEST_PREFIX);
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("PortfolioService.findPublicByUsername — visibility model", () => {
  it("returns a PUBLIC portfolio whose owner has the portfolio capability", async () => {
    const user = await createTestUser({ name: "public-eligible" });
    await grantPro(user.id);
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

    const dto = await portfolioService.findPublicByUsername({ username: user.username! });

    expect(dto.user.username).toBe(user.username);
  });

  it("shows a PRO_PLUS owner's portfolio too", async () => {
    const user = await createTestUser({ name: "plus-owner" });
    await insertGrant(user.id, granterId, { plan: "PRO_PLUS" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

    const dto = await portfolioService.findPublicByUsername({ username: user.username! });

    expect(dto.user.username).toBe(user.username);
  });

  it("hides a PUBLIC portfolio whose owner has no portfolio capability, without touching the stored preference", async () => {
    const user = await createTestUser({ name: "public-ineligible" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

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
    await grantPro(user.id);
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PRIVATE });

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });

  it("lets the owner keep viewing and editing while ineligible for public display", async () => {
    const user = await createTestUser({ name: "owner-ineligible" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

    const actor = actorFor(user.id);

    const mine = await portfolioService.findMine({ actor });
    expect(mine).not.toBeNull();

    const updated = await portfolioService.updateProfile({
      actor,
      dto: { headline: "Still editable while ineligible" },
    });
    expect(updated.headline).toBe("Still editable while ineligible");
  });

  it("restores public display automatically when access is granted again, with no other write", async () => {
    const user = await createTestUser({ name: "restore" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });
    await grantPro(user.id);

    await portfolioService.findPublicByUsername({ username: user.username! });
    const before = await prisma.portfolio.findUniqueOrThrow({ where: { userId: user.id } });

    await revokeGrants(user.id, granterId);
    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);

    await grantPro(user.id);

    const dto = await portfolioService.findPublicByUsername({ username: user.username! });
    expect(dto.user.username).toBe(user.username);

    // The portfolio row is exactly what it was: losing and regaining access
    // wrote nothing to it.
    const after = await prisma.portfolio.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after).toEqual(before);
  });

  it("follows an expired grant by the clock alone, with no job running", async () => {
    const user = await createTestUser({ name: "expiry" });
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });
    const grant = await grantPro(user.id);

    await portfolioService.findPublicByUsername({ username: user.username! });

    await prisma.entitlementGrant.update({
      where: { id: grant.id },
      data: { validUntil: new Date(Date.now() - 1000) },
    });

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });

  it("follows the owner's access, never their platform role: an admin owner without a grant is not public", async () => {
    const admin = await createTestUser({ name: "admin-owner", role: PlatformRole.ADMIN });
    await createTestPortfolio({ userId: admin.id, visibility: PortfolioVisibility.PUBLIC });

    await expect(
      portfolioService.findPublicByUsername({ username: admin.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });

  it("hides a portfolio whose owner is banned, even when PUBLIC and eligible", async () => {
    const user = await createTestUser({ name: "owner-banned", banned: true });
    await grantPro(user.id);
    await createTestPortfolio({ userId: user.id, visibility: PortfolioVisibility.PUBLIC });

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });

  it("hides a soft-deleted portfolio", async () => {
    const user = await createTestUser({ name: "deleted" });
    await grantPro(user.id);
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
