/**
 * Shared entitlement fixtures for integration tests.
 *
 * Phase II gates are exercised by grants — the only access source until
 * Phase III — so every gated feature's tests need the same three moves: give a
 * user a plan, take it away, and clean up. Grants are written directly: these
 * helpers set up the read side, and the grant write path has its own tests
 * (`modules/billing/backend/grants`).
 *
 * `EntitlementGrant.user` is `onDelete: Restrict`, so a test must remove its
 * grants before it removes its users — `deleteGrantsForUsers` does that.
 */
import type { MembershipPlan } from "@/generated/prisma";
import prisma from "@/lib/prisma";

export interface GrantFixture {
  readonly plan: MembershipPlan;
  readonly validFrom?: Date;
  readonly validUntil?: Date | null;
  readonly status?: "ACTIVE" | "REVOKED";
}

/**
 * Inserts an `ADMIN_GRANT`. The granter must be a different user: the
 * database refuses a self-grant.
 */
export async function insertGrant(userId: string, granterId: string, data: GrantFixture) {
  const revoked = data.status === "REVOKED";

  return prisma.entitlementGrant.create({
    data: {
      userId,
      plan: data.plan,
      source: "ADMIN_GRANT",
      status: data.status ?? "ACTIVE",
      // Far in the past by default, so a grant is valid whatever frozen "now"
      // a test evaluates at.
      validFrom: data.validFrom ?? new Date("2000-01-01T00:00:00.000Z"),
      validUntil: data.validUntil ?? null,
      grantedByUserId: granterId,
      reason: "test fixture",
      ...(revoked && { revokedAt: new Date(), revokedByUserId: granterId, revokeReason: "test" }),
    },
  });
}

/**
 * Revokes every active grant a user holds, as a downgrade would: the rows stay
 * (revocation is recorded, never a delete), and access falls back to FREE.
 */
export async function revokeGrants(userId: string, revokerId: string): Promise<void> {
  await prisma.entitlementGrant.updateMany({
    where: { userId, status: "ACTIVE" },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedByUserId: revokerId,
      revokeReason: "test downgrade",
    },
  });
}

/** Removes grants and grant audit rows for the given users, so they can be deleted. */
export async function deleteGrantsForUsers(userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;

  await prisma.grantAuditEntry.deleteMany({ where: { targetUserId: { in: [...userIds] } } });
  await prisma.entitlementGrant.deleteMany({ where: { userId: { in: [...userIds] } } });
}

/** `deleteGrantsForUsers` for every user whose email starts with `prefix`. */
export async function deleteGrantsForEmailPrefix(prefix: string): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  });

  await deleteGrantsForUsers(users.map((user) => user.id));
}

/**
 * The shared agreement fixtures: users whose grants cover every way a grant
 * can or cannot contribute at `now`. Both the Phase I resolver test and the
 * notification scheduler test assert that the set-based predicate and the
 * per-user resolver agree on exactly these, so the two forms cannot drift.
 */
export function agreementFixtures(now: Date): ReadonlyArray<{
  readonly name: string;
  readonly grants: readonly GrantFixture[];
}> {
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const ahead = (days: number) => new Date(now.getTime() + days * DAY);

  return [
    { name: "free", grants: [] },
    { name: "pro", grants: [{ plan: "PRO", validFrom: ago(1) }] },
    { name: "plus", grants: [{ plan: "PRO_PLUS", validFrom: ago(1), validUntil: ahead(5) }] },
    { name: "expired-plus", grants: [{ plan: "PRO_PLUS", validFrom: ago(9), validUntil: ago(1) }] },
    { name: "future-plus", grants: [{ plan: "PRO_PLUS", validFrom: ahead(1) }] },
    { name: "revoked-plus", grants: [{ plan: "PRO_PLUS", validFrom: ago(3), status: "REVOKED" }] },
    {
      name: "mixed",
      grants: [
        { plan: "PRO_PLUS", validFrom: ago(9), validUntil: ago(2) },
        { plan: "PRO", validFrom: ago(1) },
      ],
    },
    {
      name: "pro-then-plus",
      grants: [
        { plan: "PRO", validFrom: ago(4) },
        { plan: "PRO_PLUS", validFrom: ago(1) },
      ],
    },
  ];
}

/**
 * Gives `userId` a plan, using a granter user belonging to the same test
 * prefix (so the prefix-scoped cleanup removes it too). For suites whose
 * subject is not entitlements themselves but which need a user who already
 * holds a capability, e.g. one who may create a portfolio.
 */
export async function grantPlanWithFixtureGranter(
  userId: string,
  plan: MembershipPlan,
  prefix: string,
) {
  const granterId = `${prefix}_fixture_granter`;

  await prisma.user.upsert({
    where: { id: granterId },
    update: {},
    create: {
      id: granterId,
      name: "Fixture Granter",
      email: `${granterId}@example.test`,
    },
  });

  return insertGrant(userId, granterId, { plan });
}
