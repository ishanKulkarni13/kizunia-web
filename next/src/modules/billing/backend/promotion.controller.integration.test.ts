/**
 * Phase VII promotion endpoints — HTTP contract, end to end: redemption
 * (`POST /me/billing/promotions/redeem`) and the admin routes.
 *
 * Only the session is faked. `Route.execute`, the rate limiter, validation,
 * authorization, the service and the database are real. The integration setup
 * blanks `RAZORPAY_*`, so billing is disabled here, and redemption must work
 * regardless: a promotion never involves a provider.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { session } = vi.hoisted(() => ({ session: { actorId: "", role: "user" } }));

vi.mock("@/lib/auth/session", () => ({
  SessionService: {
    getStrictActor: vi.fn(async () => {
      if (!session.actorId) {
        const { AuthenticationError } = await import("@/lib/errors");
        throw new AuthenticationError({ status: 401, code: "UNAUTHORIZED", message: "User is not authenticated." });
      }
      return { id: session.actorId, role: session.role, banned: false };
    }),
  },
}));

import { PlatformRole } from "@/authorization";
import { resolveEffectiveAccess } from "@/lib/entitlements";
import prisma from "@/lib/prisma";
import { deleteGrantsForUsers } from "@/testing/entitlement-fixtures";

import { BillingAdminController } from "./admin.controller";
import { BillingController } from "./controller";

const PREFIX = "__vitest_promotion_http__";
const CODE_PREFIX = "VTPROMOHTTP";
const DAY = 24 * 60 * 60 * 1000;

let sequence = 0;

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

async function json(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as { success: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } },
  };
}

async function signIn(role: string = PlatformRole.USER) {
  const id = `${PREFIX}-${role.toLowerCase()}-${Date.now()}-${(sequence += 1)}-${Math.floor(Math.random() * 1e6)}`;

  await prisma.user.create({ data: { id, name: "Promo HTTP", email: `${id}@example.test`, role } });
  session.actorId = id;
  session.role = role;

  return id;
}

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
      createdByUserId: "some-admin",
      ...overrides,
    },
  });
}

const redeem = (body: unknown) => BillingController.redeemPromotion(post("/api/v1/me/billing/promotions/redeem", body));

async function cleanup() {
  const users = await prisma.user.findMany({ where: { id: { startsWith: PREFIX } }, select: { id: true } });

  await deleteGrantsForUsers(users.map((user) => user.id));
  await prisma.promotionRedemption.deleteMany({ where: { promotion: { code: { startsWith: CODE_PREFIX } } } });
  await prisma.grantAuditEntry.deleteMany({ where: { promotion: { code: { startsWith: CODE_PREFIX } } } });
  await prisma.entitlementGrant.deleteMany({ where: { promotion: { code: { startsWith: CODE_PREFIX } } } });
  await prisma.promotion.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
  await prisma.rateLimit.deleteMany({ where: { key: { contains: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  await signIn();
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("POST /api/v1/me/billing/promotions/redeem", () => {
  it("requires a session", async () => {
    session.actorId = "";

    expect((await redeem({ code: "ANYTHING" })).status).toBe(401);
  });

  it("redeems for the session user: 201 with the access they now have, no provider involved", async () => {
    const promo = await promotion({ plan: "PRO_PLUS", durationDays: 14 });

    const { status, body } = await json(await redeem({ code: promo.code.toLowerCase() }));

    expect(status).toBe(201);
    expect(body.data).toMatchObject({ code: promo.code, plan: "PRO_PLUS" });
    expect((await resolveEffectiveAccess(session.actorId)).plan).toBe("PRO_PLUS");
  });

  it("answers a repeat with 409 PROMOTION_ALREADY_REDEEMED", async () => {
    const promo = await promotion();

    await redeem({ code: promo.code });
    const { status, body } = await json(await redeem({ code: promo.code }));

    expect(status).toBe(409);
    expect(body.error?.code).toBe("PROMOTION_ALREADY_REDEEMED");
  });

  it("answers 409 PROMOTION_SOLD_OUT at the limit", async () => {
    const promo = await promotion({ remainingRedemptions: 0 });

    const { status, body } = await json(await redeem({ code: promo.code }));

    expect(status).toBe(409);
    expect(body.error?.code).toBe("PROMOTION_SOLD_OUT");
  });

  it("answers 422 PROMOTION_CODE_INVALID for an unknown, expired or not-yet-valid code, the same for each", async () => {
    const expired = await promotion({ validFrom: new Date(Date.now() - 2 * DAY), validUntil: new Date(Date.now() - DAY) });
    const early = await promotion({ validFrom: new Date(Date.now() + DAY) });

    for (const code of ["VTPROMOHTTP-UNKNOWN", expired.code, early.code]) {
      const { status, body } = await json(await redeem({ code }));

      expect(status).toBe(422);
      expect(body.error).toMatchObject({ code: "PROMOTION_CODE_INVALID", message: "That code isn't valid." });
    }
  });

  it("refuses every field that would let a client decide the outcome: the user, the plan, the duration, a promotion id, an Offer", async () => {
    const promo = await promotion({ plan: "PRO", durationDays: 1 });
    const tampered: Record<string, unknown>[] = [
      { userId: "someone-else" },
      { plan: "PRO_PLUS" },
      { durationDays: 3650 },
      { promotionId: promo.id },
      { eligible: true },
      { offerId: "offer_abc" },
      { remainingRedemptions: 1000 },
    ];

    for (const extra of tampered) {
      const { status } = await json(await redeem({ code: promo.code, ...extra }));

      expect(status, JSON.stringify(extra)).toBe(422);
    }

    expect(await prisma.entitlementGrant.count({ where: { userId: session.actorId } })).toBe(0);
    expect(await prisma.promotionRedemption.count({ where: { promotionId: promo.id } })).toBe(0);
  });

  it("refuses a malformed or empty code", async () => {
    for (const code of ["", "  ", "a b", "x".repeat(65), 5, null]) {
      expect((await json(await redeem({ code }))).status).toBe(422);
    }
    expect((await json(await redeem({}))).status).toBe(422);
  });

  it("carries no provider identifier and no internal id in its answer", async () => {
    const promo = await promotion();

    const { body } = await json(await redeem({ code: promo.code }));

    expect(Object.keys(body.data ?? {}).sort()).toEqual(["code", "plan", "validFrom", "validUntil"]);
  });

  it("is rate-limited per user (promotions:redeem): a code cannot be guessed by hammering", async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 11; i += 1) statuses.push((await redeem({ code: `VTPROMOHTTP-GUESS-${i}` })).status);

    expect(statuses.slice(0, 10).every((status) => status === 422)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("does not let one user's exhausted budget limit another's", async () => {
    for (let i = 0; i < 11; i += 1) await redeem({ code: `VTPROMOHTTP-GUESS-${i}` });
    await signIn();

    expect((await redeem({ code: "VTPROMOHTTP-GUESS-X" })).status).toBe(422);
  });
});

describe("admin promotion routes", () => {
  const body = () => ({ code: `${CODE_PREFIX}-admin-${Date.now()}-${(sequence += 1)}`, plan: "PRO", durationDays: 30, maxRedemptions: 10, validUntil: null });
  const create = (payload: unknown) => BillingAdminController.createPromotion(post("/api/v1/admin/billing/promotions", payload));
  const list = () => BillingAdminController.listPromotions(new NextRequest("http://localhost/api/v1/admin/billing/promotions"));

  it("requires a session", async () => {
    session.actorId = "";

    expect((await create(body())).status).toBe(401);
    expect((await list()).status).toBe(401);
  });

  it.each([PlatformRole.USER, PlatformRole.MODERATOR, PlatformRole.ADMIN])("answers 403 to %s for both create and list", async (role) => {
    await signIn(role);

    expect((await create(body())).status).toBe(403);
    expect((await list()).status).toBe(403);
  });

  it("lets a SUPER_ADMIN create (201) and list, and a redeemer then uses the code", async () => {
    await signIn(PlatformRole.SUPER_ADMIN);
    const payload = body();

    const created = await json(await create(payload));
    const listed = await json(await list());

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: payload.code.toUpperCase(), plan: "PRO", remainingRedemptions: 10, state: "ACTIVE" });
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body.data)).toContain(payload.code.toUpperCase());

    await signIn();
    expect((await json(await redeem({ code: payload.code }))).status).toBe(201);
  });

  it("refuses a body that would loosen a limit by omission or smuggle a field in", async () => {
    await signIn(PlatformRole.SUPER_ADMIN);
    const payload = body();
    const withoutMax = Object.fromEntries(Object.entries(payload).filter(([name]) => name !== "maxRedemptions"));

    for (const bad of [withoutMax, { ...payload, remainingRedemptions: 5 }, { ...payload, source: "ADMIN_GRANT" }, { ...payload, durationDays: 0 }, { ...payload, maxRedemptions: 0 }, { ...payload, code: "no spaces" }]) {
      expect((await create(bad)).status, JSON.stringify(bad)).toBe(422);
    }
    expect(await prisma.promotion.count({ where: { code: { startsWith: CODE_PREFIX } } })).toBe(0);
  });

  it("answers 409 for a duplicate code", async () => {
    await signIn(PlatformRole.SUPER_ADMIN);
    const payload = body();

    await create(payload);
    const { status, body: answer } = await json(await create(payload));

    expect(status).toBe(409);
    expect(answer.error?.code).toBe("PROMOTION_CODE_TAKEN");
  });
});
