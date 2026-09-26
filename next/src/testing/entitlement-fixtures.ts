/**
 * Shared entitlement fixtures for integration tests.
 *
 * Phase II gates are exercised by grants, the access source that needs no
 * payment provider, so every gated feature's tests need the same three moves:
 * give a user a plan, take it away, and clean up. Grants are written directly:
 * these helpers set up the read side, and the grant write path has its own
 * tests (`modules/billing/backend/grants`).
 *
 * Phase III makes subscriptions a second source. `insertSubscription` writes
 * one directly, in whatever phase and provider mode a test needs, again to set
 * up the read side (the sync apply path that will write them arrives in
 * Phase IV).
 *
 * `EntitlementGrant.user` and `Subscription.user` are `onDelete: Restrict`, so
 * a test must remove its grants and subscriptions before it removes its users:
 * `deleteGrantsForUsers` does both.
 */
import type { MembershipPlan, ProviderMode, SubscriptionPhase } from "@/generated/prisma";
import { expectedBillingMode } from "@/lib/entitlements/billing-mode";
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

export interface SubscriptionFixture {
  readonly plan: MembershipPlan;
  readonly phase: SubscriptionPhase;
  /** Defaults to the deployment's expected mode, so the row contributes when its phase does. */
  readonly providerMode?: ProviderMode;
}

/**
 * Inserts a subscription row in the given phase, with no provider identifier:
 * the read side never looks at one. A contributing phase in the expected mode
 * grants the plan; anything else does not (that is what the tests assert).
 */
export async function insertSubscription(userId: string, data: SubscriptionFixture) {
  return prisma.subscription.create({
    data: {
      userId,
      kind: "STANDARD",
      providerMode: data.providerMode ?? expectedBillingMode(),
      plan: data.plan,
      cycle: "MONTHLY",
      phase: data.phase,
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

/**
 * Removes grants, grant audit rows and subscriptions for the given users, so
 * they can be deleted. (Named for grants, which came first; it is the one
 * cleanup hook every gated feature's suite already calls, so it covers the
 * subscriptions a suite may add without touching each call site.)
 *
 * Every billing FK is `Restrict`, so once the sync path has written history,
 * events, money facts, operations or anomalies for a subscription, those go
 * first, in dependency order.
 */
export async function deleteGrantsForUsers(userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;

  const users = { in: [...userIds] };
  const subscriptionIds = (
    await prisma.subscription.findMany({ where: { userId: users }, select: { id: true } })
  ).map((subscription) => subscription.id);
  const subscriptions = { in: subscriptionIds };

  // A promotion redemption points at its grant (Restrict), so it goes first (Phase VII).
  await prisma.promotionRedemption.deleteMany({ where: { userId: users } });
  await prisma.grantAuditEntry.deleteMany({ where: { targetUserId: users } });
  await prisma.entitlementGrant.deleteMany({ where: { userId: users } });

  await prisma.subscriptionHistoryEntry.deleteMany({
    where: { OR: [{ userId: users }, { subscriptionId: subscriptions }] },
  });
  await prisma.billingMoneyFact.deleteMany({
    where: { OR: [{ userId: users }, { subscriptionId: subscriptions }] },
  });
  await prisma.billingEvent.deleteMany({ where: { subscriptionId: subscriptions } });
  // Children before their roots: the self-FK is Restrict.
  await prisma.billingOperation.deleteMany({
    where: { OR: [{ userId: users }, { subscriptionId: subscriptions }], parentOperationId: { not: null } },
  });
  await prisma.billingOperation.deleteMany({
    where: { OR: [{ userId: users }, { subscriptionId: subscriptions }] },
  });
  await prisma.billingAnomaly.deleteMany({
    where: { OR: [{ userId: users }, { subscriptionIds: { hasSome: subscriptionIds } }] },
  });
  await prisma.subscription.updateMany({ where: { id: subscriptions }, data: { supersededById: null } });
  await prisma.subscription.deleteMany({ where: { userId: users } });
}

/** `deleteGrantsForUsers` for every user whose email starts with `prefix`. */
export async function deleteGrantsForEmailPrefix(prefix: string): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  });

  await deleteGrantsForUsers(users.map((user) => user.id));
}

export interface AgreementFixture {
  readonly name: string;
  readonly grants: readonly GrantFixture[];
  readonly subscriptions: readonly SubscriptionFixture[];
}

/**
 * The shared agreement fixtures: users whose grants and subscriptions cover
 * every way a source can or cannot contribute at `now`. Both the resolver test
 * and the notification scheduler test assert that the set-based predicate and
 * the per-user resolver agree on exactly these, so the two forms cannot drift.
 *
 * Subscriptions are in the deployment's expected mode unless a fixture says
 * otherwise, and they contribute by phase, not by time.
 */
export function agreementFixtures(now: Date): readonly AgreementFixture[] {
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const ahead = (days: number) => new Date(now.getTime() + days * DAY);

  const expected = expectedBillingMode();
  const otherMode: ProviderMode = expected === "LIVE" ? "TEST" : "LIVE";

  const grantFixtures: ReadonlyArray<{ readonly name: string; readonly grants: readonly GrantFixture[] }> = [
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

  const subscriptionFixtures: readonly AgreementFixture[] = [
    // The three contributing phases...
    { name: "sub-active-pro", grants: [], subscriptions: [{ plan: "PRO", phase: "ACTIVE" }] },
    { name: "sub-trialing-plus", grants: [], subscriptions: [{ plan: "PRO_PLUS", phase: "TRIALING" }] },
    // ...PAST_DUE still contributes: a payment retry must not cost access...
    { name: "sub-past-due-plus", grants: [], subscriptions: [{ plan: "PRO_PLUS", phase: "PAST_DUE" }] },
    // ...every other phase grants nothing, whatever plan it names...
    {
      name: "sub-non-contributing-phases",
      grants: [],
      subscriptions: (
        [
          "PROVISIONING",
          "PENDING_AUTHENTICATION",
          "HALTED",
          "PAUSED",
          "CANCELLED",
          "EXPIRED",
          "COMPLETED",
          "ABANDONED",
        ] as const
      ).map((phase) => ({ plan: "PRO_PLUS" as const, phase })),
    },
    // ...and a subscription from the other provider mode is not this
    // deployment's, even in a contributing phase.
    {
      name: "sub-wrong-mode",
      grants: [],
      subscriptions: [{ plan: "PRO_PLUS", phase: "ACTIVE", providerMode: otherMode }],
    },
    // The highest source wins, whichever kind it is (SB-EA-06).
    {
      name: "sub-pro-and-grant-plus",
      grants: [{ plan: "PRO_PLUS", validFrom: ago(1) }],
      subscriptions: [{ plan: "PRO", phase: "ACTIVE" }],
    },
    {
      name: "grant-pro-and-sub-plus",
      grants: [{ plan: "PRO", validFrom: ago(1) }],
      subscriptions: [{ plan: "PRO_PLUS", phase: "ACTIVE" }],
    },
    // A higher plan that has ended does not outrank a lower one that has not.
    {
      name: "sub-cancelled-plus-and-active-pro",
      grants: [],
      subscriptions: [
        { plan: "PRO_PLUS", phase: "CANCELLED" },
        { plan: "PRO", phase: "ACTIVE" },
      ],
    },
    // Several open subscriptions: the highest counts.
    {
      name: "sub-two-active",
      grants: [],
      subscriptions: [
        { plan: "PRO", phase: "ACTIVE" },
        { plan: "PRO_PLUS", phase: "PAST_DUE" },
      ],
    },
  ];

  return [...grantFixtures.map((fixture) => ({ ...fixture, subscriptions: [] })), ...subscriptionFixtures];
}

/** Inserts everything a fixture describes for a user. */
export async function insertFixtureEntitlements(
  userId: string,
  granterId: string,
  fixture: AgreementFixture,
): Promise<void> {
  for (const grant of fixture.grants) await insertGrant(userId, granterId, grant);
  for (const subscription of fixture.subscriptions) await insertSubscription(userId, subscription);
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
