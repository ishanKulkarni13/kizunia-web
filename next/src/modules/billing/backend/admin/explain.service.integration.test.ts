/**
 * Admin "explain access" (Phase VIII): the resolver's own explanation, never a
 * second decision. It must agree with `resolveEffectiveAccess`, name why each
 * source does or does not contribute, and carry the decoration a support
 * engineer needs. ADMIN and SUPER_ADMIN may read it; MODERATOR and USER may not.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { PlatformRole } from "@/authorization";
import { resolveEffectiveAccess } from "@/lib/entitlements";
import { ForbiddenError } from "@/lib/errors";
import prisma from "@/lib/prisma";
import { actorWithRole, insertAnomaly, insertHistoryEntry } from "@/testing/billing-admin-fixtures";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";
import { insertGrant } from "@/testing/entitlement-fixtures";

import { BillingUserNotFoundError } from "../../errors";
import { AdminExplainService } from "./explain.service";

const PREFIX = "__vitest_billing_admin_explain__";
const NOW = new Date("2026-10-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const service = new AdminExplainService({ now: () => NOW, expectedMode: "TEST" });

afterEach(async () => {
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("AdminExplainService.explain", () => {
  it("explains every source, agrees with the resolver, and names the winner", async () => {
    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);
    const granter = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await createBillingUser(PREFIX, "subject");

    const contributing = await insertBoundSubscription(userId, { phase: "ACTIVE", plan: "PRO" });
    const otherMode = await insertBoundSubscription(userId, { phase: "ACTIVE", plan: "PRO_PLUS", providerMode: "LIVE" });
    const halted = await insertBoundSubscription(userId, { phase: "HALTED", plan: "PRO_PLUS" });
    await insertHistoryEntry(contributing.id, userId, { observationAt: new Date("2026-09-20T00:00:00.000Z") });

    const active = await insertGrant(userId, granter.id, { plan: "PRO" });
    const scheduled = await insertGrant(userId, granter.id, { plan: "PRO_PLUS", validFrom: new Date(NOW.getTime() + DAY) });
    const expired = await insertGrant(userId, granter.id, {
      plan: "PRO_PLUS",
      validFrom: new Date(NOW.getTime() - 10 * DAY),
      validUntil: new Date(NOW.getTime() - DAY),
    });
    const revoked = await insertGrant(userId, granter.id, { plan: "PRO_PLUS", status: "REVOKED" });

    const result = await service.explain(admin, userId);
    const resolved = await resolveEffectiveAccess(userId, { now: NOW, expectedMode: "TEST" });

    expect(result.plan).toBe(resolved.plan);
    expect(result.plan).toBe("PRO");
    expect(result.expectedMode).toBe("TEST");
    expect(result.user).toMatchObject({ id: userId });

    const subs = Object.fromEntries(
      result.sources.flatMap((s) => (s.kind === "SUBSCRIPTION" ? [[s.subscriptionId, s]] : [])),
    );
    expect(subs[contributing.id]).toMatchObject({ contribution: "CONTRIBUTING", contributes: true });
    expect(subs[otherMode.id]).toMatchObject({ contribution: "MODE_MISMATCH", contributes: false, providerMode: "LIVE" });
    expect(subs[halted.id]).toMatchObject({ contribution: "NON_CONTRIBUTING_PHASE", contributes: false });
    expect(subs[contributing.id].subscription).toMatchObject({
      cycle: "MONTHLY",
      phaseSince: "2026-09-20T00:00:00.000Z",
      providerSubscriptionId: contributing.providerSubscriptionId,
    });

    const grants = Object.fromEntries(result.sources.flatMap((s) => (s.kind === "GRANT" ? [[s.grantId, s]] : [])));
    expect(grants[active.id]).toMatchObject({ state: "ACTIVE", contributes: true });
    expect(grants[scheduled.id]).toMatchObject({ state: "SCHEDULED", contributes: false });
    expect(grants[expired.id]).toMatchObject({ state: "EXPIRED", contributes: false });
    expect(grants[revoked.id]).toMatchObject({ state: "REVOKED", contributes: false });
    expect(grants[active.id].grant).toMatchObject({ reason: "test fixture", grantedBy: { id: granter.id } });

    expect(result.sources[0]).toEqual({ kind: "DEFAULT", plan: "FREE", contributes: true });
    // The earliest-created contributing source at the winning plan: the subscription.
    expect(result.winningSource).toEqual({ kind: "SUBSCRIPTION", subscriptionId: contributing.id });
    expect(result.permissions).toEqual({ canManageBilling: false, canViewRawPayloads: false });
  });

  it("falls back to FREE with only the default contributing", async () => {
    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);
    const userId = await createBillingUser(PREFIX, "free");

    const result = await service.explain(admin, userId);

    expect(result.plan).toBe("FREE");
    expect(result.winningSource).toEqual({ kind: "DEFAULT" });
    expect(result.sources).toHaveLength(1);
  });

  it("lists the user's open anomalies, not resolved ones", async () => {
    const admin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const userId = await createBillingUser(PREFIX, "anomalous");
    const open = await insertAnomaly(PREFIX, { userId });
    await insertAnomaly(PREFIX, { userId, resolvedAt: NOW, resolutionReason: "done" });

    const result = await service.explain(admin, userId);

    expect(result.openAnomalies.map((a) => a.id)).toEqual([open.id]);
    expect(result.permissions).toEqual({ canManageBilling: true, canViewRawPayloads: true });
  });

  it("refuses MODERATOR and USER, and 404s an unknown user", async () => {
    const userId = await createBillingUser(PREFIX, "target");

    for (const role of [PlatformRole.MODERATOR, PlatformRole.USER]) {
      await expect(service.explain(await actorWithRole(PREFIX, role), userId)).rejects.toBeInstanceOf(ForbiddenError);
    }

    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);
    await expect(service.explain(admin, `${PREFIX}missing`)).rejects.toBeInstanceOf(BillingUserNotFoundError);
  });
});

describe("AdminExplainService.lookupUser", () => {
  it("finds a user by id or by e-mail, case-insensitively normalized by the schema", async () => {
    const admin = await actorWithRole(PREFIX, PlatformRole.ADMIN);
    const userId = await createBillingUser(PREFIX, "lookup");
    const { email } = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await expect(service.lookupUser(admin, { userId })).resolves.toMatchObject({ id: userId, email });
    await expect(service.lookupUser(admin, { email })).resolves.toMatchObject({ id: userId });
    await expect(service.lookupUser(admin, { email: `${PREFIX}nobody@example.test` })).rejects.toBeInstanceOf(
      BillingUserNotFoundError,
    );
    await expect(
      service.lookupUser(await actorWithRole(PREFIX, PlatformRole.MODERATOR), { userId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
