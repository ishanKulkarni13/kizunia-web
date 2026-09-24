/**
 * Billing controllers — HTTP contract, end to end.
 *
 * Only the session is faked. Controllers, `Route.execute`, the rate limiter,
 * authorization, services and the database are all real, so this asserts what a
 * client actually sees: status codes, the `{ success, data | error }` envelope,
 * and that the admin routes enforce the IB-15 role matrix.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { session } = vi.hoisted(() => ({ session: { actorId: "", role: "user" } }));

vi.mock("@/lib/auth/session", () => ({
  SessionService: {
    getStrictActor: vi.fn(async () => {
      if (!session.actorId) {
        const { AuthenticationError } = await import("@/lib/errors");
        throw new AuthenticationError({
          status: 401,
          code: "UNAUTHORIZED",
          message: "User is not authenticated.",
        });
      }
      return { id: session.actorId, role: session.role, banned: false };
    }),
  },
}));

import { PlatformRole } from "@/authorization";
import { resolveEffectiveAccess } from "@/lib/entitlements";
import prisma from "@/lib/prisma";

import { BillingAdminController } from "./admin.controller";
import { BillingController } from "./controller";

const PREFIX = "__vitest_billing_controller_test__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(suffix: string, role: string = PlatformRole.USER) {
  const id = unique(suffix);
  const email = `${id}@example.test`;
  await prisma.user.create({ data: { id, name: `Controller Test ${suffix}`, email, role } });
  return { id, email, role };
}

function signIn(user: { id: string; role: string } | null) {
  session.actorId = user?.id ?? "";
  session.role = user?.role ?? "user";
}

function request(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function cleanup() {
  await prisma.grantAuditEntry.deleteMany({ where: { targetUserId: { startsWith: PREFIX } } });
  await prisma.entitlementGrant.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.rateLimit.deleteMany({ where: { key: { contains: PREFIX } } });
}

let boss: Awaited<ReturnType<typeof createUser>>;
let admin: Awaited<ReturnType<typeof createUser>>;
let member: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await cleanup();
  boss = await createUser("boss", PlatformRole.SUPER_ADMIN);
  admin = await createUser("admin", PlatformRole.ADMIN);
  member = await createUser("member");
  signIn(null);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const validCreate = () => ({
  userId: member.id,
  plan: "PRO_PLUS",
  durationDays: 30,
  reason: "Controller test",
});

describe("GET /api/v1/me/entitlements", () => {
  it("is 401 without a session", async () => {
    const response = await BillingController.getMyEntitlements(request("GET", "/api/v1/me/entitlements"));

    expect(response.status).toBe(401);
    expect((await response.json()).success).toBe(false);
  });

  it("returns FREE flags and quotas for a user with no grants", async () => {
    signIn(member);

    const response = await BillingController.getMyEntitlements(request("GET", "/api/v1/me/entitlements"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        plan: "FREE",
        capabilities: { portfolio: false, deadlineNotifications: false, recommendations: false, mcp: false },
        quotas: { ownedProjects: 5 },
      },
    });
  });

  it("reflects a grant immediately, and its revocation immediately", async () => {
    signIn(boss);
    const created = await BillingAdminController.createGrant(
      request("POST", "/api/v1/admin/billing/grants", validCreate()),
    );
    const grantId = (await created.json()).data.id as string;

    signIn(member);
    let body = await (
      await BillingController.getMyEntitlements(request("GET", "/api/v1/me/entitlements"))
    ).json();
    expect(body.data.plan).toBe("PRO_PLUS");
    expect(body.data.capabilities).toEqual({
      portfolio: true,
      deadlineNotifications: true,
      recommendations: true,
      mcp: true,
    });
    expect(body.data.quotas.ownedProjects).toBe(20);

    signIn(boss);
    await BillingAdminController.revokeGrant(
      request("POST", `/api/v1/admin/billing/grants/${grantId}/revoke`, { reason: "Test over" }),
      grantId,
    );

    signIn(member);
    body = await (await BillingController.getMyEntitlements(request("GET", "/api/v1/me/entitlements"))).json();
    expect(body.data.plan).toBe("FREE");
  });
});

describe("expiry through the endpoint (no job runs)", () => {
  it("falls back to FREE once a grant's window ends, and to the lower plan beneath it", async () => {
    const day = 86_400_000;
    // One grant that has already ended, and one still running beneath it.
    await prisma.entitlementGrant.createMany({
      data: [
        {
          userId: member.id,
          plan: "PRO_PLUS",
          source: "ADMIN_GRANT",
          validFrom: new Date(Date.now() - 20 * day),
          validUntil: new Date(Date.now() - day),
          grantedByUserId: boss.id,
          reason: "Ended yesterday",
        },
      ],
    });
    signIn(member);

    const onlyExpired = await BillingController.getMyEntitlements(request("GET", "/api/v1/me/entitlements"));
    expect((await onlyExpired.json()).data.plan).toBe("FREE");

    await prisma.entitlementGrant.create({
      data: {
        userId: member.id,
        plan: "PRO",
        source: "ADMIN_GRANT",
        validFrom: new Date(Date.now() - day),
        validUntil: null,
        grantedByUserId: boss.id,
        reason: "Still running",
      },
    });
    const withLower = await BillingController.getMyEntitlements(request("GET", "/api/v1/me/entitlements"));
    expect((await withLower.json()).data.plan).toBe("PRO");

    // Reading never changed the expired grant's stored status.
    const expired = await prisma.entitlementGrant.findFirstOrThrow({ where: { userId: member.id, reason: "Ended yesterday" } });
    expect(expired.status).toBe("ACTIVE");
  });
});

describe("admin grant routes", () => {
  it("are 401 without a session", async () => {
    const response = await BillingAdminController.listGrants(request("GET", "/api/v1/admin/billing/grants"));

    expect(response.status).toBe(401);
  });

  it("let SUPER_ADMIN create (201), list, extend and revoke", async () => {
    signIn(boss);

    const created = await BillingAdminController.createGrant(
      request("POST", "/api/v1/admin/billing/grants", { ...validCreate(), durationDays: 10 }),
    );
    expect(created.status).toBe(201);
    const grant = (await created.json()).data;
    expect(grant).toMatchObject({ plan: "PRO_PLUS", state: "ACTIVE", recipient: { id: member.id } });

    const listed = await BillingAdminController.listGrants(
      request("GET", `/api/v1/admin/billing/grants?userId=${encodeURIComponent(member.id)}`),
    );
    const listBody = await listed.json();
    expect(listed.status).toBe(200);
    expect(listBody.data.items.map((item: { id: string }) => item.id)).toEqual([grant.id]);
    expect(listBody.data.permissions.canManage).toBe(true);

    const newEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const extended = await BillingAdminController.extendGrant(
      request("POST", `/api/v1/admin/billing/grants/${grant.id}/extend`, { validUntil: newEnd, reason: "More" }),
      grant.id,
    );
    expect(extended.status).toBe(200);
    expect((await extended.json()).data.validUntil).toBe(newEnd);

    const revoked = await BillingAdminController.revokeGrant(
      request("POST", `/api/v1/admin/billing/grants/${grant.id}/revoke`, { reason: "Done" }),
      grant.id,
    );
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).data.state).toBe("REVOKED");
  });

  it("let ADMIN list (canManage: false) but refuse create, extend and revoke with 403", async () => {
    signIn(boss);
    const grant = (
      await (
        await BillingAdminController.createGrant(request("POST", "/api/v1/admin/billing/grants", validCreate()))
      ).json()
    ).data;

    signIn(admin);
    const listed = await BillingAdminController.listGrants(request("GET", "/api/v1/admin/billing/grants"));
    expect(listed.status).toBe(200);
    expect((await listed.json()).data.permissions.canManage).toBe(false);

    const create = await BillingAdminController.createGrant(
      request("POST", "/api/v1/admin/billing/grants", validCreate()),
    );
    expect(create.status).toBe(403);

    const extend = await BillingAdminController.extendGrant(
      request("POST", `/api/v1/admin/billing/grants/${grant.id}/extend`, {
        validUntil: new Date(Date.now() + 200 * 86_400_000).toISOString(),
        reason: "Nope",
      }),
      grant.id,
    );
    expect(extend.status).toBe(403);

    const revoke = await BillingAdminController.revokeGrant(
      request("POST", `/api/v1/admin/billing/grants/${grant.id}/revoke`, { reason: "Nope" }),
      grant.id,
    );
    expect(revoke.status).toBe(403);

    expect((await resolveEffectiveAccess(member.id)).plan).toBe("PRO_PLUS");
  });

  it("refuse an ordinary user with 403", async () => {
    signIn(member);

    const listed = await BillingAdminController.listGrants(request("GET", "/api/v1/admin/billing/grants"));
    const created = await BillingAdminController.createGrant(
      request("POST", "/api/v1/admin/billing/grants", validCreate()),
    );

    expect(listed.status).toBe(403);
    expect(created.status).toBe(403);
    expect((await created.json()).error.category).toBe("authorization");
  });

  it("validate the body: 422 for a bad body, an unknown field or a missing reason", async () => {
    signIn(boss);

    for (const body of [
      {},
      { ...validCreate(), plan: "FREE" },
      { ...validCreate(), reason: "" },
      { ...validCreate(), userId: undefined },
      { ...validCreate(), promotionId: "x" },
      { ...validCreate(), durationDays: 0 },
    ]) {
      const response = await BillingAdminController.createGrant(
        request("POST", "/api/v1/admin/billing/grants", body),
      );
      expect(response.status, JSON.stringify(body)).toBe(422);
    }

    expect(await prisma.entitlementGrant.count({ where: { userId: member.id } })).toBe(0);
  });

  it("refuse a self-grant with 403 and a stable error code", async () => {
    signIn(boss);

    const response = await BillingAdminController.createGrant(
      request("POST", "/api/v1/admin/billing/grants", { ...validCreate(), userId: boss.id }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("ENTITLEMENT_SELF_GRANT_FORBIDDEN");
  });

  it("answer 404 for an unknown recipient and an unknown grant, and 409 for revoking twice", async () => {
    signIn(boss);

    const noRecipient = await BillingAdminController.createGrant(
      request("POST", "/api/v1/admin/billing/grants", { ...validCreate(), userId: unique("ghost") }),
    );
    expect(noRecipient.status).toBe(404);
    expect((await noRecipient.json()).error.code).toBe("ENTITLEMENT_GRANT_RECIPIENT_NOT_FOUND");

    const noGrant = await BillingAdminController.revokeGrant(
      request("POST", "/api/v1/admin/billing/grants/nope/revoke", { reason: "Nothing" }),
      "nope",
    );
    expect(noGrant.status).toBe(404);

    const grant = (
      await (
        await BillingAdminController.createGrant(request("POST", "/api/v1/admin/billing/grants", validCreate()))
      ).json()
    ).data;
    const first = await BillingAdminController.revokeGrant(
      request("POST", `/api/v1/admin/billing/grants/${grant.id}/revoke`, { reason: "First" }),
      grant.id,
    );
    const second = await BillingAdminController.revokeGrant(
      request("POST", `/api/v1/admin/billing/grants/${grant.id}/revoke`, { reason: "Second" }),
      grant.id,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("ENTITLEMENT_GRANT_REVOKED");
  });

  it("answer 422 for an extension that does not lengthen the grant", async () => {
    signIn(boss);
    const grant = (
      await (
        await BillingAdminController.createGrant(request("POST", "/api/v1/admin/billing/grants", validCreate()))
      ).json()
    ).data;

    const response = await BillingAdminController.extendGrant(
      request("POST", `/api/v1/admin/billing/grants/${grant.id}/extend`, {
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        reason: "Shorter",
      }),
      grant.id,
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("ENTITLEMENT_GRANT_EXTENSION_INVALID");
  });
});
