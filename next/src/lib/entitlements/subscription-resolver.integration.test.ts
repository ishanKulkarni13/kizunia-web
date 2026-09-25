/**
 * Subscriptions as an entitlement source, against real Postgres.
 *
 * The resolver counts a subscription only in a contributing phase and only in
 * the deployment's expected provider mode, and takes the highest plan across
 * every source. Nothing here configures a payment provider: access follows the
 * phase Kizunia has recorded, so it is the same with billing disabled.
 *
 * The set-based predicate is held to the per-user resolver on the shared
 * agreement fixtures in `resolver.integration.test.ts`; this file covers the
 * behavior specific to subscriptions.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/prisma";
import { insertGrant, insertSubscription } from "@/testing/entitlement-fixtures";

import { Capability, Quota } from "./catalog";
import { explainEffectiveAccess } from "./explain";
import { entitledUsersWhere } from "./grant-predicate";
import { getQuota, hasCapability, resolveEffectiveAccess } from "./resolver";

const PREFIX = "__vitest_entitlements_subscriptions__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(suffix: string): Promise<string> {
  const id = unique(suffix);
  await prisma.user.create({ data: { id, name: "Subscription Entitlements Test", email: `${id}@example.test` } });
  return id;
}

async function cleanup() {
  await prisma.grantAuditEntry.deleteMany({ where: { targetUserId: { startsWith: PREFIX } } });
  await prisma.entitlementGrant.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.subscription.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

const NOW = new Date("2026-09-25T12:00:00.000Z");
let granter: string;

beforeEach(async () => {
  await cleanup();
  granter = await createUser("granter");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function planFor(userId: string, expectedMode: "TEST" | "LIVE" = "TEST") {
  return (await resolveEffectiveAccess(userId, { now: NOW, expectedMode })).plan;
}

describe("a contributing subscription grants its plan", () => {
  it.each(["TRIALING", "ACTIVE", "PAST_DUE"] as const)("%s grants Pro", async (phase) => {
    const user = await createUser(phase);
    await insertSubscription(user, { plan: "PRO", phase, providerMode: "TEST" });

    const access = await resolveEffectiveAccess(user, { now: NOW, expectedMode: "TEST" });

    expect(access.plan).toBe("PRO");
    expect(access.capabilities.PORTFOLIO).toBe(true);
    expect(access.capabilities.MCP).toBe(false);
    expect(access.quotas.OWNED_PROJECTS).toBe(10);
  });

  it("grants Pro+ everything", async () => {
    const user = await createUser("plus");
    await insertSubscription(user, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "TEST" });

    const access = await resolveEffectiveAccess(user, { now: NOW, expectedMode: "TEST" });

    expect(access.plan).toBe("PRO_PLUS");
    expect(access.capabilities).toEqual({
      PORTFOLIO: true,
      DEADLINE_NOTIFICATIONS: true,
      RECOMMENDATIONS: true,
      MCP: true,
    });
    expect(access.quotas.OWNED_PROJECTS).toBe(20);
  });

  it("answers capability and quota questions through the same resolution", async () => {
    const user = await createUser("helpers");
    await insertSubscription(user, { plan: "PRO", phase: "ACTIVE", providerMode: "TEST" });

    const options = { now: NOW, expectedMode: "TEST" } as const;

    expect(await hasCapability(user, Capability.PORTFOLIO, options)).toBe(true);
    expect(await hasCapability(user, Capability.RECOMMENDATIONS, options)).toBe(false);
    expect(await getQuota(user, Quota.OWNED_PROJECTS, options)).toBe(10);
  });
});

describe("a subscription that is not in a contributing phase grants nothing", () => {
  it.each([
    "PROVISIONING",
    "PENDING_AUTHENTICATION",
    "HALTED",
    "PAUSED",
    "CANCELLED",
    "EXPIRED",
    "COMPLETED",
    "ABANDONED",
  ] as const)("%s", async (phase) => {
    const user = await createUser(phase);
    await insertSubscription(user, { plan: "PRO_PLUS", phase, providerMode: "TEST" });

    expect(await planFor(user)).toBe("FREE");
    expect(await hasCapability(user, Capability.MCP, { now: NOW, expectedMode: "TEST" })).toBe(false);
  });

  it("does not let a halted subscription's higher plan outrank a lower one still contributing", async () => {
    const user = await createUser("halted-plus");
    await insertSubscription(user, { plan: "PRO_PLUS", phase: "HALTED", providerMode: "TEST" });
    await insertSubscription(user, { plan: "PRO", phase: "ACTIVE", providerMode: "TEST" });

    expect(await planFor(user)).toBe("PRO");
  });
});

describe("TEST/LIVE isolation: only the expected mode contributes (SB-EA-07)", () => {
  it("gives a TEST subscription nothing when LIVE is expected", async () => {
    const user = await createUser("test-in-live");
    await insertSubscription(user, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "TEST" });

    expect(await planFor(user, "LIVE")).toBe("FREE");
    expect(await hasCapability(user, Capability.MCP, { now: NOW, expectedMode: "LIVE" })).toBe(false);
    // ...while the same row is real in a TEST deployment.
    expect(await planFor(user, "TEST")).toBe("PRO_PLUS");
  });

  it("gives a LIVE subscription nothing when TEST is expected", async () => {
    const user = await createUser("live-in-test");
    await insertSubscription(user, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "LIVE" });

    expect(await planFor(user, "TEST")).toBe("FREE");
    expect(await planFor(user, "LIVE")).toBe("PRO_PLUS");
  });

  it("holds however the deployment states its expected mode", async () => {
    const user = await createUser("env");
    await insertSubscription(user, { plan: "PRO", phase: "ACTIVE", providerMode: "TEST" });

    // Explicit BILLING_EXPECTED_MODE.
    vi.stubEnv("BILLING_EXPECTED_MODE", "live");
    expect((await resolveEffectiveAccess(user, { now: NOW })).plan).toBe("FREE");
    vi.stubEnv("BILLING_EXPECTED_MODE", "test");
    expect((await resolveEffectiveAccess(user, { now: NOW })).plan).toBe("PRO");

    // A production deployment with nothing set expects LIVE.
    vi.stubEnv("BILLING_EXPECTED_MODE", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await resolveEffectiveAccess(user, { now: NOW })).plan).toBe("FREE");
  });

  it("applies to the set-based form too: a wrong-mode subscription selects no one", async () => {
    const user = await createUser("set-mode");
    await insertSubscription(user, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "TEST" });

    const selects = async (mode: "TEST" | "LIVE") =>
      (
        await prisma.user.findMany({
          where: { id: user, ...entitledUsersWhere(Capability.MCP, NOW, mode) },
          select: { id: true },
        })
      ).length;

    expect(await selects("LIVE")).toBe(0);
    expect(await selects("TEST")).toBe(1);
  });
});

describe("the highest plan across every source wins", () => {
  it("takes a subscription over a lower grant, and a grant over a lower subscription", async () => {
    const subscriber = await createUser("sub-over-grant");
    await insertGrant(subscriber, granter, { plan: "PRO" });
    await insertSubscription(subscriber, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "TEST" });

    const granted = await createUser("grant-over-sub");
    await insertGrant(granted, granter, { plan: "PRO_PLUS" });
    await insertSubscription(granted, { plan: "PRO", phase: "ACTIVE", providerMode: "TEST" });

    expect(await planFor(subscriber)).toBe("PRO_PLUS");
    expect(await planFor(granted)).toBe("PRO_PLUS");
  });

  it("takes the highest of several open subscriptions (SB-EA-06)", async () => {
    const user = await createUser("two-open");
    await insertSubscription(user, { plan: "PRO", phase: "ACTIVE", providerMode: "TEST" });
    await insertSubscription(user, { plan: "PRO_PLUS", phase: "PAST_DUE", providerMode: "TEST" });

    expect(await planFor(user)).toBe("PRO_PLUS");
  });

  it("falls back to a grant when the subscription ends, and to FREE when both do", async () => {
    const user = await createUser("fallback");
    const subscription = await insertSubscription(user, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "TEST" });
    await insertGrant(user, granter, { plan: "PRO" });

    expect(await planFor(user)).toBe("PRO_PLUS");

    await prisma.subscription.update({ where: { id: subscription.id }, data: { phase: "CANCELLED" } });
    expect(await planFor(user)).toBe("PRO");

    await prisma.entitlementGrant.updateMany({
      where: { userId: user },
      data: { status: "REVOKED", revokedAt: NOW, revokedByUserId: granter, revokeReason: "test" },
    });
    expect(await planFor(user)).toBe("FREE");
  });

  it("is FREE for a user with neither, and for an id that does not exist", async () => {
    expect(await planFor(await createUser("nothing"))).toBe("FREE");
    expect(await planFor(unique("ghost"))).toBe("FREE");
  });
});

describe("a subscription is read the same way, and never written", () => {
  it("resolves inside a caller's transaction", async () => {
    const user = await createUser("tx");
    await insertSubscription(user, { plan: "PRO", phase: "ACTIVE", providerMode: "TEST" });

    const plan = await prisma.$transaction(
      async (tx) => (await resolveEffectiveAccess(user, { now: NOW, db: tx, expectedMode: "TEST" })).plan,
    );

    expect(plan).toBe("PRO");
  });

  it("changes no row, whatever it reads", async () => {
    const user = await createUser("read-only");
    const subscription = await insertSubscription(user, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "TEST" });

    for (let i = 0; i < 3; i += 1) {
      await resolveEffectiveAccess(user, { now: NOW, expectedMode: "TEST" });
      await hasCapability(user, Capability.MCP, { now: NOW, expectedMode: "TEST" });
      await explainEffectiveAccess(user, { now: NOW, expectedMode: "TEST" });
      await prisma.user.findMany({ where: { id: user, ...entitledUsersWhere(Capability.MCP, NOW, "TEST") } });
    }

    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });

    expect(after.updatedAt.getTime()).toBe(subscription.updatedAt.getTime());
    expect(after.phase).toBe("ACTIVE");
  });

  it("is independent of the payment provider: no credentials are involved", async () => {
    for (const name of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_ACCOUNT_ID"]) {
      vi.stubEnv(name, "");
    }
    const user = await createUser("disabled");
    await insertSubscription(user, { plan: "PRO", phase: "ACTIVE", providerMode: "TEST" });

    expect(await planFor(user)).toBe("PRO");
  });
});

describe("explainEffectiveAccess with subscriptions", () => {
  it("lists every subscription with whether it contributes and why not", async () => {
    const user = await createUser("explain");
    const active = await insertSubscription(user, { plan: "PRO", phase: "ACTIVE", providerMode: "TEST" });
    const halted = await insertSubscription(user, { plan: "PRO_PLUS", phase: "HALTED", providerMode: "TEST" });
    const wrongMode = await insertSubscription(user, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "LIVE" });

    const explanation = await explainEffectiveAccess(user, { now: NOW, expectedMode: "TEST" });

    expect(explanation.expectedMode).toBe("TEST");
    expect(explanation.plan).toBe("PRO");
    expect(explanation.winningSource).toEqual({ kind: "SUBSCRIPTION", subscriptionId: active.id });
    expect(explanation.sources[0]).toEqual({ kind: "DEFAULT", plan: "FREE", contributes: true });

    const byId = new Map(
      explanation.sources.flatMap((source) =>
        source.kind === "SUBSCRIPTION" ? [[source.subscriptionId, source] as const] : [],
      ),
    );

    expect(byId.get(active.id)).toMatchObject({ contribution: "CONTRIBUTING", contributes: true, phase: "ACTIVE" });
    expect(byId.get(halted.id)).toMatchObject({ contribution: "NON_CONTRIBUTING_PHASE", contributes: false });
    expect(byId.get(wrongMode.id)).toMatchObject({
      contribution: "MODE_MISMATCH",
      contributes: false,
      providerMode: "LIVE",
    });
  });

  it("names a wrong-mode subscription as the reason a user has no access", async () => {
    const user = await createUser("explain-mode");
    const testRow = await insertSubscription(user, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "TEST" });

    const explanation = await explainEffectiveAccess(user, { now: NOW, expectedMode: "LIVE" });

    expect(explanation.plan).toBe("FREE");
    expect(explanation.winningSource).toEqual({ kind: "DEFAULT" });
    expect(explanation.sources).toContainEqual(
      expect.objectContaining({ subscriptionId: testRow.id, contribution: "MODE_MISMATCH" }),
    );
  });

  it("agrees with the resolver on the effective plan across sources", async () => {
    const user = await createUser("explain-agrees");
    await insertGrant(user, granter, { plan: "PRO" });
    await insertSubscription(user, { plan: "PRO_PLUS", phase: "PAST_DUE", providerMode: "TEST" });
    await insertSubscription(user, { plan: "PRO_PLUS", phase: "CANCELLED", providerMode: "TEST" });

    const options = { now: NOW, expectedMode: "TEST" } as const;

    expect((await explainEffectiveAccess(user, options)).plan).toBe(
      (await resolveEffectiveAccess(user, options)).plan,
    );
  });

  it("prefers the earliest-created source at the winning plan, a subscription before a grant on a tie", async () => {
    const user = await createUser("explain-winner");
    const grant = await insertGrant(user, granter, { plan: "PRO_PLUS" });
    const subscription = await insertSubscription(user, { plan: "PRO_PLUS", phase: "ACTIVE", providerMode: "TEST" });

    // Same plan from two sources: whichever was created first is named.
    const grantFirst = grant.createdAt.getTime() < subscription.createdAt.getTime();
    const explanation = await explainEffectiveAccess(user, { now: NOW, expectedMode: "TEST" });

    expect(explanation.winningSource).toEqual(
      grantFirst
        ? { kind: "GRANT", grantId: grant.id }
        : { kind: "SUBSCRIPTION", subscriptionId: subscription.id },
    );
  });
});
