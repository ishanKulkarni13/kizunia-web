import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { PlatformRole, type StrictAuthorizationActor } from "@/authorization";
import { ForbiddenError } from "@/lib/errors";
import { resolveEffectiveAccess } from "@/lib/entitlements";
import prisma from "@/lib/prisma";

import {
  GrantExtensionInvalidError,
  GrantNotFoundError,
  GrantRecipientNotFoundError,
  GrantRevokedError,
  SelfGrantForbiddenError,
} from "../../errors";
import { GrantService } from "./grant.service";

const PREFIX = "__vitest_grant_service_test__";
const DAY = 24 * 60 * 60 * 1000;

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

interface TestUser {
  readonly actor: StrictAuthorizationActor;
  readonly email: string;
}

async function createUser(
  suffix: string,
  role: string = PlatformRole.USER,
  banned = false,
): Promise<TestUser> {
  const id = unique(suffix);
  const email = `${id}@example.test`;
  await prisma.user.create({ data: { id, name: `Grant Test ${suffix}`, email, role, banned } });

  return { actor: { id, role, banned }, email };
}

async function cleanup() {
  await prisma.grantAuditEntry.deleteMany({ where: { targetUserId: { startsWith: PREFIX } } });
  await prisma.entitlementGrant.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

const auditOf = (grantId: string) =>
  prisma.grantAuditEntry.findMany({ where: { grantId }, orderBy: { createdAt: "asc" } });

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isoIn = (days: number) => new Date(Date.now() + days * DAY);

let boss: TestUser; // SUPER_ADMIN
let bossTwo: TestUser; // a second SUPER_ADMIN
let admin: TestUser;
let member: TestUser;

beforeEach(async () => {
  await cleanup();
  boss = await createUser("boss", PlatformRole.SUPER_ADMIN);
  bossTwo = await createUser("boss-two", PlatformRole.SUPER_ADMIN);
  admin = await createUser("admin", PlatformRole.ADMIN);
  member = await createUser("member");
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("GrantService.create", () => {
  it("creates a grant and its CREATED audit entry, and the recipient gains access", async () => {
    const before = Date.now();
    const grant = await GrantService.create(boss.actor, {
      userId: member.actor.id,
      plan: "PRO_PLUS",
      durationDays: 30,
      reason: "Hackathon prize",
    });

    expect(grant).toMatchObject({
      plan: "PRO_PLUS",
      source: "ADMIN_GRANT",
      status: "ACTIVE",
      state: "ACTIVE",
      reason: "Hackathon prize",
      recipient: { id: member.actor.id, email: member.email },
      grantedBy: { id: boss.actor.id },
    });
    expect(new Date(grant.validUntil as string).getTime() - new Date(grant.validFrom).getTime()).toBe(30 * DAY);
    expect(new Date(grant.validFrom).getTime()).toBeGreaterThanOrEqual(before - 5);

    const audit = await auditOf(grant.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "CREATED",
      performedByUserId: boss.actor.id,
      targetUserId: member.actor.id,
      plan: "PRO_PLUS",
      previousValidUntil: null,
      reason: "Hackathon prize",
    });
    expect(audit[0].newValidUntil?.toISOString()).toBe(grant.validUntil);

    expect((await resolveEffectiveAccess(member.actor.id)).plan).toBe("PRO_PLUS");
  });

  it("supports a recipient given by e-mail and a grant with no expiry", async () => {
    const grant = await GrantService.create(boss.actor, {
      email: member.email,
      plan: "PRO",
      durationDays: null,
      reason: "Team member",
    });

    expect(grant.validUntil).toBeNull();
    expect(grant.recipient?.id).toBe(member.actor.id);
    expect((await auditOf(grant.id))[0].newValidUntil).toBeNull();
  });

  it("fails with 'recipient not found' and writes nothing", async () => {
    await expect(
      GrantService.create(boss.actor, {
        email: `${unique("nobody")}@example.test`,
        plan: "PRO",
        durationDays: 7,
        reason: "Nobody",
      }),
    ).rejects.toBeInstanceOf(GrantRecipientNotFoundError);

    expect(await prisma.entitlementGrant.count({ where: { grantedByUserId: boss.actor.id } })).toBe(0);
  });

  it("refuses a self-grant in the service, writing nothing (SB-EA-08)", async () => {
    await expect(
      GrantService.create(boss.actor, {
        userId: boss.actor.id,
        plan: "PRO_PLUS",
        durationDays: 30,
        reason: "Give myself access",
      }),
    ).rejects.toBeInstanceOf(SelfGrantForbiddenError);

    // Also by e-mail — the check is on the resolved recipient, not the input form.
    await expect(
      GrantService.create(boss.actor, {
        email: boss.email,
        plan: "PRO",
        durationDays: 30,
        reason: "Give myself access",
      }),
    ).rejects.toBeInstanceOf(SelfGrantForbiddenError);

    expect(await prisma.entitlementGrant.count({ where: { userId: boss.actor.id } })).toBe(0);
    expect(await prisma.grantAuditEntry.count({ where: { targetUserId: boss.actor.id } })).toBe(0);
  });

  it("lets one administrator grant another", async () => {
    const grant = await GrantService.create(boss.actor, {
      userId: bossTwo.actor.id,
      plan: "PRO_PLUS",
      durationDays: 30,
      reason: "Notifications for the second admin",
    });

    expect(grant.recipient?.id).toBe(bossTwo.actor.id);
  });

  it("rolls the grant back when its audit entry cannot be written (one transaction)", async () => {
    // A blank reason bypasses the schema here to reach the database CHECK,
    // which rejects the row inside the transaction.
    await expect(
      GrantService.create(boss.actor, {
        userId: member.actor.id,
        plan: "PRO",
        durationDays: 5,
        reason: "   ",
      }),
    ).rejects.toThrow();

    expect(await prisma.entitlementGrant.count({ where: { userId: member.actor.id } })).toBe(0);
    expect(await prisma.grantAuditEntry.count({ where: { targetUserId: member.actor.id } })).toBe(0);
  });
});

describe("database constraints (defense in depth)", () => {
  const base = () => ({
    plan: "PRO" as const,
    source: "ADMIN_GRANT" as const,
    validFrom: new Date(),
    reason: "fixture",
  });

  it("rejects a self-grant written around the service", async () => {
    await expect(
      prisma.entitlementGrant.create({
        data: { ...base(), userId: member.actor.id, grantedByUserId: member.actor.id },
      }),
    ).rejects.toThrow();
  });

  it("rejects an ADMIN_GRANT with no granting administrator", async () => {
    await expect(
      prisma.entitlementGrant.create({ data: { ...base(), userId: member.actor.id, grantedByUserId: null } }),
    ).rejects.toThrow();
  });

  it("rejects a validity window that ends before it starts", async () => {
    const validFrom = new Date();
    await expect(
      prisma.entitlementGrant.create({
        data: {
          ...base(),
          userId: member.actor.id,
          grantedByUserId: boss.actor.id,
          validFrom,
          validUntil: new Date(validFrom.getTime() - 1000),
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a revoked grant with no revokedAt, and vice versa", async () => {
    await expect(
      prisma.entitlementGrant.create({
        data: { ...base(), userId: member.actor.id, grantedByUserId: boss.actor.id, status: "REVOKED" },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.entitlementGrant.create({
        data: { ...base(), userId: member.actor.id, grantedByUserId: boss.actor.id, revokedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it("refuses to hard-delete a user who has grants (Restrict)", async () => {
    await GrantService.create(boss.actor, {
      userId: member.actor.id,
      plan: "PRO",
      durationDays: 30,
      reason: "Restrict test",
    });

    await expect(prisma.user.delete({ where: { id: member.actor.id } })).rejects.toThrow();
    expect(await prisma.user.count({ where: { id: member.actor.id } })).toBe(1);
  });
});

describe("GrantService.extend", () => {
  async function grantFor(days: number | null) {
    return GrantService.create(boss.actor, {
      userId: member.actor.id,
      plan: "PRO",
      durationDays: days,
      reason: "Initial",
    });
  }

  it("lengthens a grant and audits previous → new", async () => {
    const grant = await grantFor(10);
    const newEnd = isoIn(40);

    const extended = await GrantService.extend(boss.actor, grant.id, {
      validUntil: newEnd,
      reason: "Extended after review",
    });

    expect(extended.validUntil).toBe(newEnd.toISOString());
    expect(extended.state).toBe("ACTIVE");

    const audit = await auditOf(grant.id);
    expect(audit.map((entry) => entry.action)).toEqual(["CREATED", "EXTENDED"]);
    expect(audit[1]).toMatchObject({
      performedByUserId: boss.actor.id,
      targetUserId: member.actor.id,
      reason: "Extended after review",
    });
    expect(audit[1].previousValidUntil?.toISOString()).toBe(grant.validUntil);
    expect(audit[1].newValidUntil?.toISOString()).toBe(newEnd.toISOString());
  });

  it("can remove the expiry", async () => {
    const grant = await grantFor(10);
    const extended = await GrantService.extend(boss.actor, grant.id, { validUntil: null, reason: "Now permanent" });

    expect(extended.validUntil).toBeNull();
    expect((await auditOf(grant.id))[1].newValidUntil).toBeNull();
  });

  it("allows extending an EXPIRED grant, which contributes again from then on", async () => {
    // A grant whose window has already ended (created directly, as an admin cannot create a past grant).
    const past = await prisma.entitlementGrant.create({
      data: {
        userId: member.actor.id,
        plan: "PRO",
        source: "ADMIN_GRANT",
        validFrom: isoIn(-20),
        validUntil: isoIn(-5),
        grantedByUserId: boss.actor.id,
        reason: "Long ago",
      },
    });
    expect((await resolveEffectiveAccess(member.actor.id)).plan).toBe("FREE");

    const extended = await GrantService.extend(boss.actor, past.id, {
      validUntil: isoIn(30),
      reason: "Welcome back",
    });

    expect(extended.state).toBe("ACTIVE");
    expect((await resolveEffectiveAccess(member.actor.id)).plan).toBe("PRO");
    expect((await auditOf(past.id))[0].previousValidUntil?.toISOString()).toBe(past.validUntil?.toISOString());
  });

  it("refuses an extension that does not lengthen the grant, writing no audit entry", async () => {
    const grant = await grantFor(30);

    await expect(
      GrantService.extend(boss.actor, grant.id, { validUntil: isoIn(10), reason: "Shorter" }),
    ).rejects.toBeInstanceOf(GrantExtensionInvalidError);
    await expect(
      GrantService.extend(boss.actor, grant.id, { validUntil: new Date(grant.validUntil as string), reason: "Same" }),
    ).rejects.toBeInstanceOf(GrantExtensionInvalidError);

    expect(await auditOf(grant.id)).toHaveLength(1);
    expect((await prisma.entitlementGrant.findUniqueOrThrow({ where: { id: grant.id } })).validUntil?.toISOString()).toBe(
      grant.validUntil,
    );
  });

  it("refuses an extension that still ends in the past", async () => {
    const past = await prisma.entitlementGrant.create({
      data: {
        userId: member.actor.id,
        plan: "PRO",
        source: "ADMIN_GRANT",
        validFrom: isoIn(-30),
        validUntil: isoIn(-20),
        grantedByUserId: boss.actor.id,
        reason: "Long ago",
      },
    });

    await expect(
      GrantService.extend(boss.actor, past.id, { validUntil: isoIn(-10), reason: "Still past" }),
    ).rejects.toBeInstanceOf(GrantExtensionInvalidError);
  });

  it("refuses to extend a grant that already has no expiry", async () => {
    const grant = await grantFor(null);

    await expect(
      GrantService.extend(boss.actor, grant.id, { validUntil: isoIn(10), reason: "Pointless" }),
    ).rejects.toBeInstanceOf(GrantExtensionInvalidError);
  });

  it("refuses to extend a revoked grant", async () => {
    const grant = await grantFor(10);
    await GrantService.revoke(boss.actor, grant.id, { reason: "Abuse" });

    await expect(
      GrantService.extend(boss.actor, grant.id, { validUntil: isoIn(90), reason: "Undo" }),
    ).rejects.toBeInstanceOf(GrantRevokedError);
    expect((await prisma.entitlementGrant.findUniqueOrThrow({ where: { id: grant.id } })).status).toBe("REVOKED");
    expect((await resolveEffectiveAccess(member.actor.id)).plan).toBe("FREE");
  });

  it("refuses an administrator extending a grant made to themselves (SB-EA-08)", async () => {
    const toBossTwo = await GrantService.create(boss.actor, {
      userId: bossTwo.actor.id,
      plan: "PRO",
      durationDays: 10,
      reason: "Notifications",
    });

    await expect(
      GrantService.extend(bossTwo.actor, toBossTwo.id, { validUntil: isoIn(60), reason: "Longer for me" }),
    ).rejects.toBeInstanceOf(SelfGrantForbiddenError);
    // The other administrator can.
    await expect(
      GrantService.extend(boss.actor, toBossTwo.id, { validUntil: isoIn(60), reason: "Longer" }),
    ).resolves.toMatchObject({ state: "ACTIVE" });
  });

  it("reports 'not found' for an unknown grant", async () => {
    await expect(
      GrantService.extend(boss.actor, "no-such-grant", { validUntil: isoIn(5), reason: "Nothing" }),
    ).rejects.toBeInstanceOf(GrantNotFoundError);
  });

  it("commits the change and its audit entry together, or neither (one transaction)", async () => {
    const grant = await grantFor(10);

    // A blank reason bypasses the schema to make the audit insert fail after
    // the grant update has run; the update must roll back with it.
    await expect(
      GrantService.extend(boss.actor, grant.id, { validUntil: isoIn(50), reason: "   " }),
    ).rejects.toThrow();

    expect((await prisma.entitlementGrant.findUniqueOrThrow({ where: { id: grant.id } })).validUntil?.toISOString()).toBe(
      grant.validUntil,
    );
    expect(await auditOf(grant.id)).toHaveLength(1);
  });
});

describe("GrantService.revoke", () => {
  it("revokes, records who and why, audits, and drops the recipient's access", async () => {
    const grant = await GrantService.create(boss.actor, {
      userId: member.actor.id,
      plan: "PRO_PLUS",
      durationDays: 30,
      reason: "Initial",
    });
    expect((await resolveEffectiveAccess(member.actor.id)).plan).toBe("PRO_PLUS");

    const revoked = await GrantService.revoke(bossTwo.actor, grant.id, { reason: "Abuse report" });

    expect(revoked).toMatchObject({
      status: "REVOKED",
      state: "REVOKED",
      revokeReason: "Abuse report",
      revokedBy: { id: bossTwo.actor.id },
    });
    expect(revoked.revokedAt).not.toBeNull();
    expect((await resolveEffectiveAccess(member.actor.id)).plan).toBe("FREE");

    const audit = await auditOf(grant.id);
    expect(audit.map((entry) => entry.action)).toEqual(["CREATED", "REVOKED"]);
    expect(audit[1]).toMatchObject({
      performedByUserId: bossTwo.actor.id,
      targetUserId: member.actor.id,
      reason: "Abuse report",
    });
    // The row is kept — revocation is recorded, not deletion.
    expect(await prisma.entitlementGrant.count({ where: { id: grant.id } })).toBe(1);
  });

  it("is final: a second revoke is a conflict and adds no audit entry", async () => {
    const grant = await GrantService.create(boss.actor, {
      userId: member.actor.id,
      plan: "PRO",
      durationDays: 30,
      reason: "Initial",
    });
    await GrantService.revoke(boss.actor, grant.id, { reason: "First" });

    await expect(GrantService.revoke(boss.actor, grant.id, { reason: "Second" })).rejects.toBeInstanceOf(
      GrantRevokedError,
    );
    expect(await auditOf(grant.id)).toHaveLength(2);
  });

  it("reports 'not found' for an unknown grant", async () => {
    await expect(GrantService.revoke(boss.actor, "no-such-grant", { reason: "Nothing" })).rejects.toBeInstanceOf(
      GrantNotFoundError,
    );
  });
});

describe("concurrent extend and revoke", () => {
  /**
   * Holds the grant's row lock in another transaction while both mutations are
   * launched, so they queue on the lock and are released together — the tightest
   * interleaving the database allows.
   */
  async function raceExtendAgainstRevoke(grantId: string, newEnd: Date) {
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "entitlement_grant" WHERE id = ${grantId} FOR UPDATE`;
      await delay(300);
    });
    await delay(100); // the lock is held

    const [extend, revoke] = await Promise.allSettled([
      GrantService.extend(boss.actor, grantId, { validUntil: newEnd, reason: "Race: extend" }),
      GrantService.revoke(bossTwo.actor, grantId, { reason: "Race: revoke" }),
    ]);
    await holder;

    return { extend, revoke };
  }

  it("never resurrects a revoked grant, whichever wins, and audits each success (repeated)", async () => {
    for (let round = 0; round < 8; round++) {
      const grant = await GrantService.create(boss.actor, {
        userId: member.actor.id,
        plan: "PRO_PLUS",
        durationDays: 10,
        reason: `Round ${round}`,
      });
      const original = grant.validUntil as string;
      const newEnd = isoIn(100 + round);

      const { extend, revoke } = await raceExtendAgainstRevoke(grant.id, newEnd);

      // Revocation always succeeds against a concurrent extension...
      expect(revoke.status, `round ${round}: revoke`).toBe("fulfilled");

      // ...and the grant always ends REVOKED, contributing nothing.
      const final = await prisma.grantAuditEntry.findMany({ where: { grantId: grant.id } });
      const stored = await prisma.entitlementGrant.findUniqueOrThrow({ where: { id: grant.id } });
      expect(stored.status).toBe("REVOKED");
      expect(stored.revokedAt).not.toBeNull();
      expect((await resolveEffectiveAccess(member.actor.id)).plan).toBe("FREE");

      const revokeAudit = final.find((entry) => entry.action === "REVOKED");
      expect(final.filter((entry) => entry.action === "REVOKED")).toHaveLength(1);

      if (extend.status === "fulfilled") {
        // Extend committed first, then revoke saw its result.
        expect(final.filter((entry) => entry.action === "EXTENDED")).toHaveLength(1);
        expect(stored.validUntil?.toISOString()).toBe(newEnd.toISOString());
        expect(revokeAudit?.previousValidUntil?.toISOString()).toBe(newEnd.toISOString());
      } else {
        // Revoke committed first: the extension was refused, and changed nothing.
        expect(extend.reason).toBeInstanceOf(GrantRevokedError);
        expect(final.filter((entry) => entry.action === "EXTENDED")).toHaveLength(0);
        expect(stored.validUntil?.toISOString()).toBe(original);
        expect(revokeAudit?.previousValidUntil?.toISOString()).toBe(original);
      }

      // One audit entry per successful mutation, plus the creation.
      expect(final).toHaveLength(1 + (extend.status === "fulfilled" ? 1 : 0) + 1);
    }
  });

  it("serializes two concurrent revokes: one wins, one conflict, one audit entry", async () => {
    const grant = await GrantService.create(boss.actor, {
      userId: member.actor.id,
      plan: "PRO",
      durationDays: 10,
      reason: "Double revoke",
    });

    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "entitlement_grant" WHERE id = ${grant.id} FOR UPDATE`;
      await delay(300);
    });
    await delay(100);

    const results = await Promise.allSettled([
      GrantService.revoke(boss.actor, grant.id, { reason: "A" }),
      GrantService.revoke(bossTwo.actor, grant.id, { reason: "B" }),
    ]);
    await holder;

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(GrantRevokedError);
    expect((await auditOf(grant.id)).filter((entry) => entry.action === "REVOKED")).toHaveLength(1);
  });
});

describe("authorization (IB-15 role matrix)", () => {
  const input = () => ({
    userId: member.actor.id,
    plan: "PRO" as const,
    durationDays: 7,
    reason: "Authorization test",
  });

  it.each([
    ["ADMIN", () => admin],
    ["MODERATOR", () => createUser("mod", PlatformRole.MODERATOR)],
    ["USER", () => createUser("plain")],
  ])("refuses %s create, extend and revoke", async (_label, make) => {
    const other = await make();
    const grant = await GrantService.create(boss.actor, input());

    await expect(GrantService.create(other.actor, input())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      GrantService.extend(other.actor, grant.id, { validUntil: isoIn(30), reason: "Nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(GrantService.revoke(other.actor, grant.id, { reason: "Nope" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Nothing changed.
    expect((await prisma.entitlementGrant.findUniqueOrThrow({ where: { id: grant.id } })).status).toBe("ACTIVE");
    expect(await auditOf(grant.id)).toHaveLength(1);
  });

  it("refuses a banned SUPER_ADMIN — the ban is read from the database, not the session", async () => {
    const banned = await createUser("banned-boss", PlatformRole.SUPER_ADMIN, true);
    // The session copy of the actor claims it is not banned.
    const staleActor: StrictAuthorizationActor = { ...banned.actor, banned: false };

    await expect(GrantService.create(staleActor, input())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("uses the role in the database, so a demoted SUPER_ADMIN loses access immediately", async () => {
    const demoted = await createUser("demoted", PlatformRole.SUPER_ADMIN);
    await prisma.user.update({ where: { id: demoted.actor.id }, data: { role: PlatformRole.USER } });

    // The session copy still claims SUPER_ADMIN.
    await expect(GrantService.create(demoted.actor, input())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets ADMIN list grants, without the manage permission", async () => {
    await GrantService.create(boss.actor, input());

    const list = await GrantService.list(admin.actor, { userId: member.actor.id });

    expect(list.items).toHaveLength(1);
    expect(list.permissions.canManage).toBe(false);
  });

  it("refuses MODERATOR and USER listing", async () => {
    const mod = await createUser("mod-list", PlatformRole.MODERATOR);

    await expect(GrantService.list(mod.actor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(GrantService.list(member.actor, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("GrantService.list", () => {
  it("reports the derived state, the audit trail, filters and pagination", async () => {
    const active = await GrantService.create(boss.actor, {
      userId: member.actor.id,
      plan: "PRO",
      durationDays: 30,
      reason: "Active one",
    });
    const revoked = await GrantService.create(boss.actor, {
      userId: member.actor.id,
      plan: "PRO_PLUS",
      durationDays: 30,
      reason: "Revoked one",
    });
    await GrantService.revoke(boss.actor, revoked.id, { reason: "Changed mind" });
    await prisma.entitlementGrant.create({
      data: {
        userId: member.actor.id,
        plan: "PRO",
        source: "ADMIN_GRANT",
        validFrom: isoIn(-20),
        validUntil: isoIn(-5),
        grantedByUserId: boss.actor.id,
        reason: "Expired one",
      },
    });

    const list = await GrantService.list(boss.actor, { email: member.email });

    expect(list.permissions.canManage).toBe(true);
    expect(list.pagination.total).toBe(3);
    const byReason = new Map(list.items.map((item) => [item.reason, item]));
    expect(byReason.get("Active one")?.state).toBe("ACTIVE");
    expect(byReason.get("Revoked one")?.state).toBe("REVOKED");
    expect(byReason.get("Expired one")?.state).toBe("EXPIRED");
    // "Expired" is derived — the stored status of the expired grant is still ACTIVE.
    expect(byReason.get("Expired one")?.status).toBe("ACTIVE");
    expect(byReason.get(revoked.reason)?.auditTrail.map((entry) => entry.action)).toEqual(["CREATED", "REVOKED"]);
    expect(byReason.get("Active one")?.grantedBy).toEqual({ id: boss.actor.id, name: "Grant Test boss" });

    const onlyRevoked = await GrantService.list(boss.actor, { email: member.email, status: "REVOKED" });
    expect(onlyRevoked.items.map((item) => item.id)).toEqual([revoked.id]);

    const secondPage = await GrantService.list(boss.actor, { userId: member.actor.id, limit: "2", page: "2" });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.pagination).toMatchObject({ page: 2, limit: 2, total: 3, hasNextPage: false, hasPreviousPage: true });
    // Newest first: expired, revoked, then the oldest — the active one — on page 2.
    expect(secondPage.items[0].id).toBe(active.id);
  });
});
