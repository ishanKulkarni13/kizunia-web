/**
 * Promotions (Phase VII), against real Postgres: redemption is one
 * transaction (grant + redemption + conditional decrement + audit, all or
 * nothing), once per user, never beyond the limit, from two tabs or from many
 * users racing for the last slot; access follows the grant through the ordinary
 * resolver and falls back by clock alone; one authorization chain for admin.
 *
 * No provider is involved anywhere: promotions work with billing disabled.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformRole, type StrictAuthorizationActor } from "@/authorization";
import { resolveEffectiveAccess } from "@/lib/entitlements";
import { ForbiddenError } from "@/lib/errors";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { deleteGrantsForUsers } from "@/testing/entitlement-fixtures";
import { insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import {
  PromotionAlreadyRedeemedError,
  PromotionCodeInvalidError,
  PromotionCodeTakenError,
  PromotionNotEligibleError,
  PromotionSoldOutError,
  PromotionWindowInvalidError,
} from "../../errors";
import { CreatePromotionSchema } from "../../schemas/promotion";
import { createOfferCatalog } from "../../config/offer-catalog";
import { createStaticOfferCodeSource } from "../offers/offer-code-source";
import { GrantRepository } from "./grant.repository";
import { GrantService } from "./grant.service";
import { PromotionService } from "./promotion.service";

const PREFIX = "__vitest_promotion_test__";
const CODE_PREFIX = "VTPROMO";
const DAY = 24 * 60 * 60 * 1000;

let sequence = 0;
let records: LogRecord[];

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${(sequence += 1)}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(name: string, role: string = PlatformRole.USER, banned = false): Promise<StrictAuthorizationActor> {
  const id = unique(name);

  await prisma.user.create({ data: { id, name: `Promo Test ${name}`, email: `${id}@example.test`, role, banned } });

  return { id, role, banned };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { id: { startsWith: PREFIX } }, select: { id: true } });

  // Redemptions point at grants, audit entries and grants at promotions (all Restrict): dependency order.
  await deleteGrantsForUsers(users.map((user) => user.id));
  await prisma.promotionRedemption.deleteMany({ where: { promotion: { code: { startsWith: CODE_PREFIX } } } });
  await prisma.grantAuditEntry.deleteMany({ where: { promotion: { code: { startsWith: CODE_PREFIX } } } });
  await prisma.entitlementGrant.deleteMany({ where: { promotion: { code: { startsWith: CODE_PREFIX } } } });
  await prisma.promotion.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

let creator: StrictAuthorizationActor;

async function promotion(overrides: Partial<Parameters<typeof prisma.promotion.create>[0]["data"]> = {}) {
  return prisma.promotion.create({
    data: {
      code: `${CODE_PREFIX}-${Date.now()}-${(sequence += 1)}`.toUpperCase(),
      plan: "PRO",
      durationDays: 30,
      remainingRedemptions: 5,
      validFrom: new Date(Date.now() - DAY),
      validUntil: null,
      eligibility: "ANY_USER",
      createdByUserId: creator.id,
      ...overrides,
    },
  });
}

const redeem = (actor: StrictAuthorizationActor, code: string, now?: Date) => PromotionService.redeem(actor, { code }, now ? { now: () => now } : {});

/** Everything a redemption writes, for the "all or nothing" assertions. */
async function footprint(promotionId: string, userId?: string) {
  const [grants, redemptions, audits, row] = await Promise.all([
    prisma.entitlementGrant.count({ where: { promotionId, ...(userId && { userId }) } }),
    prisma.promotionRedemption.count({ where: { promotionId, ...(userId && { userId }) } }),
    prisma.grantAuditEntry.count({ where: { promotionId, ...(userId && { targetUserId: userId }) } }),
    prisma.promotion.findUniqueOrThrow({ where: { id: promotionId }, select: { remainingRedemptions: true } }),
  ]);

  return { grants, redemptions, audits, remaining: row.remainingRedemptions };
}

const events = (name: string) => records.filter((record) => record.event === name);

beforeEach(async () => {
  await cleanup();
  records = [];
  setLogSink((record) => {
    records.push(record);
  });
  creator = await createUser("creator", PlatformRole.SUPER_ADMIN);
});
afterEach(async () => {
  resetLogSink();
  vi.restoreAllMocks();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("redeeming a promotion", () => {
  it("creates the grant, the redemption and the audit entry, takes a slot, and gives the plan", async () => {
    const promo = await promotion({ plan: "PRO_PLUS", durationDays: 30, remainingRedemptions: 5 });
    const user = await createUser("user");
    const at = new Date();

    const result = await redeem(user, promo.code, at);

    expect(result).toEqual({
      code: promo.code,
      plan: "PRO_PLUS",
      validFrom: at.toISOString(),
      validUntil: new Date(at.getTime() + 30 * DAY).toISOString(),
    });

    const [grant] = await prisma.entitlementGrant.findMany({ where: { userId: user.id } });
    expect(grant).toMatchObject({
      source: "PROMOTION",
      status: "ACTIVE",
      plan: "PRO_PLUS",
      promotionId: promo.id,
      grantedByUserId: null,
      reason: promo.code,
    });
    expect(grant.validFrom).toEqual(at);
    expect(grant.validUntil).toEqual(new Date(at.getTime() + 30 * DAY));

    expect(await prisma.promotionRedemption.findMany({ where: { promotionId: promo.id } })).toMatchObject([
      { userId: user.id, grantId: grant.id },
    ]);
    expect(await prisma.grantAuditEntry.findMany({ where: { grantId: grant.id } })).toMatchObject([
      { action: "CREATED", performedByUserId: user.id, targetUserId: user.id, promotionId: promo.id, plan: "PRO_PLUS", reason: promo.code, previousValidUntil: null },
    ]);
    expect((await footprint(promo.id)).remaining).toBe(4);
    expect((await resolveEffectiveAccess(user.id, { now: at })).plan).toBe("PRO_PLUS");
    expect(events("grant.created")).toMatchObject([{ fields: { source: "PROMOTION", promotionId: promo.id, userId: user.id } }]);
    expect(events("promotion.redeemed")).toHaveLength(1);
  });

  it("matches the code however it is typed (case and surrounding space)", async () => {
    const promo = await promotion();
    const user = await createUser("user");

    expect((await redeem(user, `  ${promo.code.toLowerCase()} `)).code).toBe(promo.code);
  });

  it("takes everything from the promotion's own record: the plan and duration are the promotion's, whatever the caller sends", async () => {
    const promo = await promotion({ plan: "PRO", durationDays: 7 });
    const user = await createUser("user");

    // The service accepts only a code; the schema refuses anything else (see the schema test).
    const result = await PromotionService.redeem(user, { code: promo.code, plan: "PRO_PLUS", durationDays: 3650, userId: "someone-else" } as never);

    expect(result.plan).toBe("PRO");
    expect(new Date(result.validUntil).getTime() - new Date(result.validFrom).getTime()).toBe(7 * DAY);
    expect(await prisma.entitlementGrant.count({ where: { userId: "someone-else" } })).toBe(0);
  });

  it("does not need a limit: an unlimited promotion keeps no counter and never sells out", async () => {
    const promo = await promotion({ remainingRedemptions: null });
    const users = await Promise.all(Array.from({ length: 4 }, (_, index) => createUser(`u${index}`)));

    await Promise.all(users.map((user) => redeem(user, promo.code)));

    expect(await footprint(promo.id)).toEqual({ grants: 4, redemptions: 4, audits: 4, remaining: null });
  });

  it("works with billing disabled: no provider, no billing mode, is ever consulted", async () => {
    const promo = await promotion();
    const user = await createUser("user");

    // The integration setup blanks the Razorpay credentials, so billing is disabled here.
    await expect(redeem(user, promo.code)).resolves.toMatchObject({ plan: "PRO" });
  });
});

describe("refusals write nothing", () => {
  it("refuses an unknown, a not-yet-valid and an expired code as one answer, with no trace", async () => {
    const early = await promotion({ validFrom: new Date(Date.now() + DAY) });
    const late = await promotion({ validFrom: new Date(Date.now() - 2 * DAY), validUntil: new Date(Date.now() - DAY) });
    const user = await createUser("user");

    for (const code of ["VTPROMO-NOPE", early.code, late.code]) {
      await expect(redeem(user, code)).rejects.toBeInstanceOf(PromotionCodeInvalidError);
    }

    for (const promo of [early, late]) expect(await footprint(promo.id)).toEqual({ grants: 0, redemptions: 0, audits: 0, remaining: 5 });
    expect(await prisma.entitlementGrant.count({ where: { userId: user.id } })).toBe(0);
  });

  it("honours the window edges exactly: usable at validFrom, gone at validUntil", async () => {
    const edge = new Date("2030-01-01T00:00:00.000Z");
    const promo = await promotion({ validFrom: edge, validUntil: new Date(edge.getTime() + DAY), remainingRedemptions: null });
    const [a, b, c] = await Promise.all(["a", "b", "c"].map((name) => createUser(name)));

    await expect(redeem(a, promo.code, new Date(edge.getTime() - 1))).rejects.toBeInstanceOf(PromotionCodeInvalidError);
    await expect(redeem(b, promo.code, edge)).resolves.toMatchObject({ plan: "PRO" });
    await expect(redeem(c, promo.code, new Date(edge.getTime() + DAY))).rejects.toBeInstanceOf(PromotionCodeInvalidError);
  });

  it("refuses a second redemption by the same user and leaves every count as it was", async () => {
    const promo = await promotion({ remainingRedemptions: 5 });
    const user = await createUser("user");
    await redeem(user, promo.code);
    const before = await footprint(promo.id, user.id);

    await expect(redeem(user, promo.code)).rejects.toBeInstanceOf(PromotionAlreadyRedeemedError);

    expect(await footprint(promo.id, user.id)).toEqual(before);
    expect((await footprint(promo.id)).remaining).toBe(4);
  });

  it("refuses a sold-out promotion and leaves every count as it was", async () => {
    const promo = await promotion({ remainingRedemptions: 0 });
    const user = await createUser("user");

    await expect(redeem(user, promo.code)).rejects.toBeInstanceOf(PromotionSoldOutError);

    expect(await footprint(promo.id)).toEqual({ grants: 0, redemptions: 0, audits: 0, remaining: 0 });
  });
});

describe("FIRST_PAID_SUBSCRIPTION_ONLY reads Subscription records only (IB-27 item 9)", () => {
  it("refuses a user who already had a paid subscription, and rolls back nothing because nothing was written", async () => {
    const promo = await promotion({ eligibility: "FIRST_PAID_SUBSCRIPTION_ONLY" });
    const user = await createUser("user");
    await insertBoundSubscription(user.id, { phase: "CANCELLED", firstContributedAt: new Date(Date.now() - DAY), providerMode: "TEST" });

    await expect(PromotionService.redeem(user, { code: promo.code }, { mode: () => "TEST" })).rejects.toBeInstanceOf(PromotionNotEligibleError);

    expect(await footprint(promo.id)).toEqual({ grants: 0, redemptions: 0, audits: 0, remaining: 5 });
  });

  it("allows a user whose paid access came only from an admin grant or an earlier promotion", async () => {
    const promo = await promotion({ eligibility: "FIRST_PAID_SUBSCRIPTION_ONLY", plan: "PRO_PLUS" });
    const earlier = await promotion({ plan: "PRO" });
    const user = await createUser("user");
    await GrantService.create(creator, { userId: user.id, plan: "PRO", durationDays: 30, reason: "Hackathon prize" });
    await redeem(user, earlier.code);

    expect((await resolveEffectiveAccess(user.id)).plan).toBe("PRO");
    await expect(PromotionService.redeem(user, { code: promo.code }, { mode: () => "TEST" })).resolves.toMatchObject({ plan: "PRO_PLUS" });
  });

  it("allows a user whose only subscriptions never reached a contributing phase, or are in another mode", async () => {
    const promo = await promotion({ eligibility: "FIRST_PAID_SUBSCRIPTION_ONLY" });
    const user = await createUser("user");
    await insertBoundSubscription(user.id, { phase: "EXPIRED", firstContributedAt: null, providerMode: "TEST", providerSubscriptionId: `sub_${unique("a")}` });
    await insertBoundSubscription(user.id, { phase: "CANCELLED", firstContributedAt: new Date(), providerMode: "LIVE", providerSubscriptionId: `sub_${unique("b")}` });

    await expect(PromotionService.redeem(user, { code: promo.code }, { mode: () => "TEST" })).resolves.toMatchObject({ plan: "PRO" });
  });
});

describe("concurrency", () => {
  it("lets exactly one of several simultaneous redemptions by the same user succeed, with one of everything", async () => {
    const promo = await promotion({ remainingRedemptions: 3 });
    const user = await createUser("user");

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => redeem(user, promo.code)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(PromotionAlreadyRedeemedError);
    }
    expect(await footprint(promo.id, user.id)).toEqual({ grants: 1, redemptions: 1, audits: 1, remaining: 2 });
  });

  it("lets exactly one of several users take the last slot; the losers leave nothing behind", async () => {
    const promo = await promotion({ remainingRedemptions: 1 });
    const users = await Promise.all(Array.from({ length: 6 }, (_, index) => createUser(`racer${index}`)));

    const results = await Promise.allSettled(users.map((user) => redeem(user, promo.code)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(PromotionSoldOutError);
    }

    // One grant, one redemption, one audit entry, the counter at zero: nothing from the six losers.
    expect(await footprint(promo.id)).toEqual({ grants: 1, redemptions: 1, audits: 1, remaining: 0 });
    expect(await prisma.entitlementGrant.count({ where: { userId: { in: users.map((user) => user.id) } } })).toBe(1);
  });

  it("never sells more than the limit, however many users ask (limit 3, ten users)", async () => {
    const promo = await promotion({ remainingRedemptions: 3 });
    const users = await Promise.all(Array.from({ length: 10 }, (_, index) => createUser(`m${index}`)));

    const results = await Promise.allSettled(users.map((user) => redeem(user, promo.code)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(await footprint(promo.id)).toEqual({ grants: 3, redemptions: 3, audits: 3, remaining: 0 });
  });
});

describe("atomicity: grant + redemption + decrement + audit commit together or not at all", () => {
  it("rolls everything back, the decrement included, when the last step fails", async () => {
    const promo = await promotion({ remainingRedemptions: 2 });
    const user = await createUser("user");
    vi.spyOn(GrantRepository.prototype, "createAudit").mockRejectedValueOnce(new Error("audit write failed"));

    await expect(redeem(user, promo.code)).rejects.toThrow("audit write failed");

    expect(await footprint(promo.id)).toEqual({ grants: 0, redemptions: 0, audits: 0, remaining: 2 });
    expect(events("grant.created")).toHaveLength(0);
    expect(events("promotion.redeemed")).toHaveLength(0);

    // Nothing was consumed: the same user can redeem it.
    await expect(redeem(user, promo.code)).resolves.toMatchObject({ plan: "PRO" });
    expect(await footprint(promo.id)).toEqual({ grants: 1, redemptions: 1, audits: 1, remaining: 1 });
  });

  it("emits no log for a redemption that rolled back", async () => {
    const promo = await promotion({ remainingRedemptions: 0 });
    const user = await createUser("user");

    await expect(redeem(user, promo.code)).rejects.toBeInstanceOf(PromotionSoldOutError);

    expect(events("grant.created")).toHaveLength(0);
  });
});

describe("the grant is an ordinary grant: access through the one resolver", () => {
  it("expires by clock alone: access falls back with no write, no job", async () => {
    const promo = await promotion({ durationDays: 2 });
    const user = await createUser("user");
    const at = new Date();
    await redeem(user, promo.code, at);
    const before = await prisma.entitlementGrant.findFirstOrThrow({ where: { userId: user.id } });

    expect((await resolveEffectiveAccess(user.id, { now: new Date(at.getTime() + DAY) })).plan).toBe("PRO");
    expect((await resolveEffectiveAccess(user.id, { now: new Date(at.getTime() + 2 * DAY) })).plan).toBe("FREE");

    const after = await prisma.entitlementGrant.findFirstOrThrow({ where: { userId: user.id } });
    expect(after).toEqual(before);
  });

  it("takes the maximum across a promotion, a paid subscription and an admin grant, none modifying another", async () => {
    const promo = await promotion({ plan: "PRO_PLUS" });
    const user = await createUser("user");
    await insertBoundSubscription(user.id, { phase: "ACTIVE", plan: "PRO", providerMode: "TEST", firstContributedAt: new Date() });

    expect((await resolveEffectiveAccess(user.id, { expectedMode: "TEST" })).plan).toBe("PRO");
    await redeem(user, promo.code);
    expect((await resolveEffectiveAccess(user.id, { expectedMode: "TEST" })).plan).toBe("PRO_PLUS");

    const granted = await GrantService.create(creator, { userId: user.id, plan: "PRO", durationDays: null, reason: "Team member" });
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { userId: user.id } });

    expect((await resolveEffectiveAccess(user.id, { expectedMode: "TEST" })).plan).toBe("PRO_PLUS");
    expect(subscription.phase).toBe("ACTIVE");
    expect(granted.source).toBe("ADMIN_GRANT");
  });

  it("falls back to the paid subscription when the promotion's grant is revoked", async () => {
    const promo = await promotion({ plan: "PRO_PLUS" });
    const user = await createUser("user");
    await insertBoundSubscription(user.id, { phase: "ACTIVE", plan: "PRO", providerMode: "TEST", firstContributedAt: new Date() });
    await redeem(user, promo.code);
    const grant = await prisma.entitlementGrant.findFirstOrThrow({ where: { userId: user.id } });

    const revoked = await GrantService.revoke(creator, grant.id, { reason: "Redeemed in error" });

    expect(revoked).toMatchObject({ source: "PROMOTION", status: "REVOKED", grantedBy: null });
    expect((await resolveEffectiveAccess(user.id, { expectedMode: "TEST" })).plan).toBe("PRO");
    // The revocation's audit entry names the promotion too.
    expect(await prisma.grantAuditEntry.findMany({ where: { grantId: grant.id }, orderBy: { createdAt: "asc" } })).toMatchObject([
      { action: "CREATED", promotionId: promo.id },
      { action: "REVOKED", promotionId: promo.id },
    ]);
  });

  it("shows a PROMOTION grant in the admin grant list, as a promotion, with no granting administrator", async () => {
    const promo = await promotion();
    const user = await createUser("user");
    await redeem(user, promo.code);

    const list = await GrantService.list(creator, { userId: user.id });

    expect(list.items).toMatchObject([{ source: "PROMOTION", status: "ACTIVE", grantedBy: null, reason: promo.code }]);
  });
});

describe("the database refuses what the service would never write", () => {
  it("rejects a PROMOTION grant with no promotion, and an admin grant that names one", async () => {
    const user = await createUser("user");
    const promo = await promotion();
    const base = { userId: user.id, plan: "PRO" as const, validFrom: new Date(), reason: "x" };

    await expect(prisma.entitlementGrant.create({ data: { ...base, source: "PROMOTION" } })).rejects.toThrow();
    await expect(
      prisma.entitlementGrant.create({ data: { ...base, source: "ADMIN_GRANT", grantedByUserId: creator.id, promotionId: promo.id } }),
    ).rejects.toThrow();
  });

  it("rejects a negative counter, a zero duration, a backwards window, and a code that is not normalized", async () => {
    await expect(promotion({ remainingRedemptions: -1 })).rejects.toThrow();
    await expect(promotion({ durationDays: 0 })).rejects.toThrow();
    await expect(promotion({ validFrom: new Date(Date.now() + DAY), validUntil: new Date(Date.now()) })).rejects.toThrow();
    await expect(promotion({ code: `${CODE_PREFIX}-lower` })).rejects.toThrow();
  });

  it("rejects a second redemption record for the same user and promotion, and a shared grant", async () => {
    const promo = await promotion();
    const user = await createUser("user");
    await redeem(user, promo.code);
    const redemption = await prisma.promotionRedemption.findFirstOrThrow({ where: { promotionId: promo.id } });

    await expect(prisma.promotionRedemption.create({ data: { promotionId: promo.id, userId: user.id, grantId: redemption.grantId } })).rejects.toThrow();
  });

  it("refuses to delete a user who redeemed one (no cascade: history survives, IB-14)", async () => {
    const promo = await promotion();
    const user = await createUser("user");
    await redeem(user, promo.code);

    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
  });
});

describe("admin: one authorization chain — MANAGE_ENTITLEMENT_GRANTS (SUPER_ADMIN)", () => {
  const input = () =>
    CreatePromotionSchema.parse({ code: `${CODE_PREFIX}-new-${Date.now()}-${(sequence += 1)}`, plan: "PRO", durationDays: 30, maxRedemptions: 10, validUntil: null });

  it("lets a SUPER_ADMIN create a promotion (code normalized, creator recorded) and list it", async () => {
    const created = await PromotionService.create(creator, { ...input(), code: `${CODE_PREFIX}-mixed-Case` });

    expect(created).toMatchObject({
      code: `${CODE_PREFIX}-MIXED-CASE`,
      plan: "PRO",
      durationDays: 30,
      remainingRedemptions: 10,
      redemptionCount: 0,
      state: "ACTIVE",
      eligibility: "ANY_USER",
      createdBy: { id: creator.id },
    });
    expect(events("promotion.created")).toHaveLength(1);

    const list = await PromotionService.list(creator, {});
    expect(list.items.map((item) => item.id)).toContain(created.id);
  });

  it.each([PlatformRole.ADMIN, PlatformRole.MODERATOR, PlatformRole.USER])("refuses %s for both create and list", async (role) => {
    const actor = await createUser(`role-${role}`, role);

    await expect(PromotionService.create(actor, input())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(PromotionService.list(actor, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.promotion.count({ where: { createdByUserId: actor.id } })).toBe(0);
  });

  it("re-reads the role from the database: a session that still claims SUPER_ADMIN after a demotion gets nothing", async () => {
    const demoted = await createUser("demoted", PlatformRole.USER);

    await expect(PromotionService.create({ ...demoted, role: PlatformRole.SUPER_ADMIN }, input())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a banned SUPER_ADMIN", async () => {
    const banned = await createUser("banned-boss", PlatformRole.SUPER_ADMIN, true);

    await expect(PromotionService.create(banned, input())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a duplicate code, and a code that is an Offer code in any mode (disjoint, SB-CP-01)", async () => {
    const first = input();
    await PromotionService.create(creator, first);

    await expect(PromotionService.create(creator, first)).rejects.toBeInstanceOf(PromotionCodeTakenError);
    await expect(PromotionService.create(creator, { ...first, code: first.code.toLowerCase() })).rejects.toBeInstanceOf(PromotionCodeTakenError);

    const offers = createStaticOfferCodeSource(
      () => createOfferCatalog([{ marketingCode: `${CODE_PREFIX}-OFFER`, providerOfferId: "offer_x", appliesTo: [{ plan: "PRO", cycle: "MONTHLY" }], eligibility: "ANY_USER", description: "d" }]),
      (code) => code.toUpperCase() === `${CODE_PREFIX}-OFFER`,
    );
    await expect(PromotionService.create(creator, { ...input(), code: `${CODE_PREFIX}-offer` }, { offers })).rejects.toBeInstanceOf(PromotionCodeTakenError);
    expect(await prisma.promotion.count({ where: { code: `${CODE_PREFIX}-OFFER` } })).toBe(0);
  });

  it("refuses a window that ends in the past or before it starts", async () => {
    await expect(PromotionService.create(creator, { ...input(), validUntil: new Date(Date.now() - DAY) })).rejects.toBeInstanceOf(PromotionWindowInvalidError);
    await expect(
      PromotionService.create(creator, { ...input(), validFrom: new Date(Date.now() + 2 * DAY), validUntil: new Date(Date.now() + DAY) }),
    ).rejects.toBeInstanceOf(PromotionWindowInvalidError);
  });

  it("derives the state at read time: scheduled, active, expired, sold out", async () => {
    const scheduled = await promotion({ validFrom: new Date(Date.now() + DAY) });
    const expired = await promotion({ validFrom: new Date(Date.now() - 2 * DAY), validUntil: new Date(Date.now() - DAY) });
    const soldOut = await promotion({ remainingRedemptions: 0 });
    const active = await promotion();

    const items = (await PromotionService.list(creator, { limit: "100" })).items;
    const stateOf = (id: string) => items.find((item) => item.id === id)?.state;

    expect([scheduled.id, expired.id, soldOut.id, active.id].map(stateOf)).toEqual(["SCHEDULED", "EXPIRED", "SOLD_OUT", "ACTIVE"]);
  });
});
