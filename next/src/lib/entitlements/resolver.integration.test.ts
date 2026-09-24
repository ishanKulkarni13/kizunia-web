import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MembershipPlan } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { Capability, EffectivePlan } from "./catalog";
import { explainEffectiveAccess } from "./explain";
import { entitledUsersWhere } from "./grant-predicate";
import { getQuota, hasCapability, resolveEffectiveAccess } from "./resolver";
import { Quota } from "./catalog";
import { resolveEntitlements } from "./index";

const PREFIX = "__vitest_entitlements_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(suffix: string): Promise<string> {
  const id = unique(suffix);
  await prisma.user.create({ data: { id, name: "Entitlements Test", email: `${id}@example.test` } });
  return id;
}

/** Inserts a grant directly — these tests exercise the read side, not the write path. */
async function insertGrant(
  userId: string,
  granterId: string,
  data: {
    plan: MembershipPlan;
    validFrom: Date;
    validUntil?: Date | null;
    status?: "ACTIVE" | "REVOKED";
  },
) {
  const revoked = data.status === "REVOKED";

  return prisma.entitlementGrant.create({
    data: {
      userId,
      plan: data.plan,
      source: "ADMIN_GRANT",
      status: data.status ?? "ACTIVE",
      validFrom: data.validFrom,
      validUntil: data.validUntil ?? null,
      grantedByUserId: granterId,
      reason: "test fixture",
      ...(revoked && { revokedAt: new Date(), revokedByUserId: granterId, revokeReason: "test" }),
    },
  });
}

async function cleanup() {
  await prisma.grantAuditEntry.deleteMany({ where: { targetUserId: { startsWith: PREFIX } } });
  await prisma.entitlementGrant.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

const NOW = new Date("2026-09-24T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

let granter: string;

beforeEach(async () => {
  await cleanup();
  granter = await createUser("granter");
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("resolveEffectiveAccess", () => {
  it("falls back to FREE for a user with no grants", async () => {
    const user = await createUser("free");
    const access = await resolveEffectiveAccess(user, { now: NOW });

    expect(access.plan).toBe(EffectivePlan.FREE);
    expect(access.capabilities).toEqual({
      PORTFOLIO: false,
      DEADLINE_NOTIFICATIONS: false,
      RECOMMENDATIONS: false,
      MCP: false,
    });
    expect(access.quotas.OWNED_PROJECTS).toBe(5);
  });

  it("resolves FREE for a user id that does not exist", async () => {
    expect((await resolveEffectiveAccess(unique("ghost"), { now: NOW })).plan).toBe("FREE");
  });

  it("gives a PRO grant Pro access, and PRO_PLUS grants everything", async () => {
    const pro = await createUser("pro");
    const plus = await createUser("plus");
    await insertGrant(pro, granter, { plan: "PRO", validFrom: ago(1), validUntil: ahead(10) });
    await insertGrant(plus, granter, { plan: "PRO_PLUS", validFrom: ago(1) });

    const proAccess = await resolveEffectiveAccess(pro, { now: NOW });
    expect(proAccess.plan).toBe("PRO");
    expect(proAccess.capabilities.PORTFOLIO).toBe(true);
    expect(proAccess.capabilities.MCP).toBe(false);
    expect(proAccess.quotas.OWNED_PROJECTS).toBe(10);

    const plusAccess = await resolveEffectiveAccess(plus, { now: NOW });
    expect(plusAccess.plan).toBe("PRO_PLUS");
    expect(plusAccess.capabilities).toEqual({
      PORTFOLIO: true,
      DEADLINE_NOTIFICATIONS: true,
      RECOMMENDATIONS: true,
      MCP: true,
    });
    expect(plusAccess.quotas.OWNED_PROJECTS).toBe(20);
  });

  it("takes the highest plan across several valid grants (highest wins)", async () => {
    const user = await createUser("many");
    await insertGrant(user, granter, { plan: "PRO", validFrom: ago(5) });
    await insertGrant(user, granter, { plan: "PRO_PLUS", validFrom: ago(2), validUntil: ahead(3) });

    expect((await resolveEffectiveAccess(user, { now: NOW })).plan).toBe("PRO_PLUS");
    // After the higher grant ends, the lower one still contributes.
    expect((await resolveEffectiveAccess(user, { now: ahead(4) })).plan).toBe("PRO");
  });

  it("ignores revoked, expired and not-yet-valid grants", async () => {
    const user = await createUser("inert");
    await insertGrant(user, granter, { plan: "PRO_PLUS", validFrom: ago(5), status: "REVOKED" });
    await insertGrant(user, granter, { plan: "PRO_PLUS", validFrom: ago(20), validUntil: ago(10) });
    await insertGrant(user, granter, { plan: "PRO_PLUS", validFrom: ahead(2) });

    expect((await resolveEffectiveAccess(user, { now: NOW })).plan).toBe("FREE");
  });

  it("honours the exact window edges: validFrom inclusive, validUntil exclusive", async () => {
    const user = await createUser("edges");
    const from = ago(1);
    const until = ahead(1);
    await insertGrant(user, granter, { plan: "PRO", validFrom: from, validUntil: until });

    expect((await resolveEffectiveAccess(user, { now: new Date(from.getTime() - 1) })).plan).toBe("FREE");
    expect((await resolveEffectiveAccess(user, { now: from })).plan).toBe("PRO");
    expect((await resolveEffectiveAccess(user, { now: new Date(until.getTime() - 1) })).plan).toBe("PRO");
    expect((await resolveEffectiveAccess(user, { now: until })).plan).toBe("FREE");
  });

  it("answers capability and quota questions through the same resolution", async () => {
    const user = await createUser("helpers");
    await insertGrant(user, granter, { plan: "PRO", validFrom: ago(1) });

    expect(await hasCapability(user, Capability.PORTFOLIO, { now: NOW })).toBe(true);
    expect(await hasCapability(user, Capability.RECOMMENDATIONS, { now: NOW })).toBe(false);
    expect(await getQuota(user, Quota.OWNED_PROJECTS, { now: NOW })).toBe(10);
  });

  it("can resolve inside a caller's transaction", async () => {
    const user = await createUser("tx");
    await insertGrant(user, granter, { plan: "PRO", validFrom: ago(1) });

    const plan = await prisma.$transaction(async (tx) => (await resolveEffectiveAccess(user, { now: NOW, db: tx })).plan);
    expect(plan).toBe("PRO");
  });
});

describe("expiry needs no background job and reads never write", () => {
  it("stops contributing at validUntil while the stored row is untouched", async () => {
    const user = await createUser("derived");
    const grant = await insertGrant(user, granter, {
      plan: "PRO_PLUS",
      validFrom: ago(10),
      validUntil: ago(1),
    });

    // Resolve past the window, repeatedly, and through every read helper.
    for (let i = 0; i < 3; i++) {
      expect((await resolveEffectiveAccess(user, { now: NOW })).plan).toBe("FREE");
      await hasCapability(user, Capability.MCP, { now: NOW });
      await explainEffectiveAccess(user, { now: NOW });
    }
    await prisma.user.findMany({ where: entitledUsersWhere(Capability.PORTFOLIO, NOW) });

    const after = await prisma.entitlementGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(after.status).toBe("ACTIVE"); // "expired" is derived, never stored (SB-EA-09)
    expect(after.updatedAt.getTime()).toBe(grant.updatedAt.getTime());
    expect(after.validUntil?.getTime()).toBe(grant.validUntil?.getTime());
  });
});

describe("entitledUsersWhere (set-based predicate)", () => {
  it("agrees with the per-user resolver for every capability, on shared fixtures", async () => {
    const fixtures: Array<{ name: string; grants: Parameters<typeof insertGrant>[2][] }> = [
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

    const users: string[] = [];
    for (const fixture of fixtures) {
      const userId = await createUser(fixture.name);
      users.push(userId);
      for (const grant of fixture.grants) await insertGrant(userId, granter, grant);
    }

    for (const capability of Object.values(Capability)) {
      const viaSet = await prisma.user.findMany({
        where: { id: { in: users }, ...entitledUsersWhere(capability, NOW) },
        select: { id: true },
      });
      const viaSetIds = new Set(viaSet.map((row) => row.id));

      for (const userId of users) {
        expect(
          viaSetIds.has(userId),
          `${capability}: set form disagrees with resolver for ${userId}`,
        ).toBe(await hasCapability(userId, capability, { now: NOW }));
      }
    }
  });
});

describe("explainEffectiveAccess", () => {
  it("lists the FREE default and every grant with a derived state and whether it contributes", async () => {
    const user = await createUser("explain");
    const active = await insertGrant(user, granter, { plan: "PRO", validFrom: ago(2) });
    const expired = await insertGrant(user, granter, { plan: "PRO_PLUS", validFrom: ago(9), validUntil: ago(3) });
    const revoked = await insertGrant(user, granter, { plan: "PRO_PLUS", validFrom: ago(1), status: "REVOKED" });
    const scheduled = await insertGrant(user, granter, { plan: "PRO_PLUS", validFrom: ahead(3) });

    const explanation = await explainEffectiveAccess(user, { now: NOW });

    expect(explanation.plan).toBe("PRO");
    expect(explanation.winningSource).toEqual({ kind: "GRANT", grantId: active.id });
    expect(explanation.sources[0]).toEqual({ kind: "DEFAULT", plan: "FREE", contributes: true });

    const byId = new Map(
      explanation.sources.flatMap((source) => (source.kind === "GRANT" ? [[source.grantId, source] as const] : [])),
    );
    expect(byId.get(active.id)).toMatchObject({ state: "ACTIVE", contributes: true });
    expect(byId.get(expired.id)).toMatchObject({ state: "EXPIRED", contributes: false });
    expect(byId.get(revoked.id)).toMatchObject({ state: "REVOKED", contributes: false });
    expect(byId.get(scheduled.id)).toMatchObject({ state: "SCHEDULED", contributes: false });
  });

  it("names the default as the winner when no grant contributes", async () => {
    const user = await createUser("explain-free");
    await insertGrant(user, granter, { plan: "PRO", validFrom: ago(5), validUntil: ago(1) });

    const explanation = await explainEffectiveAccess(user, { now: NOW });

    expect(explanation.plan).toBe("FREE");
    expect(explanation.winningSource).toEqual({ kind: "DEFAULT" });
  });

  it("reaches the same effective plan as the resolver", async () => {
    const user = await createUser("explain-agree");
    await insertGrant(user, granter, { plan: "PRO", validFrom: ago(4) });
    await insertGrant(user, granter, { plan: "PRO_PLUS", validFrom: ago(1), validUntil: ahead(2) });

    for (const at of [ago(10), NOW, ahead(5)]) {
      expect((await explainEffectiveAccess(user, { now: at })).plan).toBe(
        (await resolveEffectiveAccess(user, { now: at })).plan,
      );
    }
  });
});

describe("rate limiting is unchanged", () => {
  it("still resolves the default tier, synchronously, without touching the database", () => {
    expect(resolveEntitlements()).toEqual({ tier: "default" });
  });
});
