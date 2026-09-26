/**
 * Admin billing tools (Phase VIII) — HTTP contract, end to end.
 *
 * Only the session is faked. The controller, `Route.execute`, the rate limiter,
 * authorization, services and the database are real, so this asserts what a
 * client sees: the IB-15 role matrix for every admin tool, the
 * `{ success, data | error }` envelope, that ADMIN is read-only, that a raw
 * payload reaches only a SUPER_ADMIN and never a log, and the rate limits.
 */
import { randomUUID } from "node:crypto";

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
import prisma from "@/lib/prisma";
import {
  actorWithRole,
  captureLogs,
  insertAnomaly,
  insertBillingEvent,
  insertHistoryEntry,
  insertMoneyFact,
} from "@/testing/billing-admin-fixtures";
import {
  cleanupBillingUsers,
  createBillingUser,
  insertBoundSubscription,
  insertOperation,
} from "@/testing/billing-sync-fixtures";

import { BillingAdminController } from "./admin.controller";
import { BulkResyncService } from "./admin/bulk-resync.service";

const PREFIX = "__vitest_billing_admin_http__";
const SECRET = "SENTINEL-http-payload-5e8c@example.test";
const BASE = "/api/v1/admin/billing";

type Role = (typeof PlatformRole)[keyof typeof PlatformRole];

interface Scene {
  userId: string;
  email: string;
  subscriptionId: string;
  eventId: string;
}

let scene: Scene;

function get(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

async function signInAs(role: Role | null) {
  if (role === null) {
    session.actorId = "";
    return null;
  }

  const actor = await actorWithRole(PREFIX, role);
  session.actorId = actor.id;
  session.role = actor.role;

  return actor;
}

async function json(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  session.actorId = "";

  const userId = await createBillingUser(PREFIX, "subject");
  const sub = await insertBoundSubscription(userId);
  const event = await insertBillingEvent(PREFIX, {
    subscriptionId: sub.id,
    providerSubscriptionId: sub.providerSubscriptionId,
    rawPayload: { payload: { customer_email: SECRET } },
  });
  await insertHistoryEntry(sub.id, userId);
  await insertOperation(userId, { subscriptionId: sub.id, request: { reason: "ADMIN_CANCEL", contact: SECRET } });
  await insertMoneyFact(PREFIX, { subscriptionId: sub.id, userId, billingEventId: event.id });
  const { email } = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  scene = { userId, email, subscriptionId: sub.id, eventId: event.id };
});
afterEach(async () => {
  session.actorId = "";
  await cleanupBillingUsers(PREFIX);
  await prisma.rateLimit.deleteMany({ where: { key: { contains: PREFIX } } });
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.rateLimit.deleteMany({ where: { key: { contains: PREFIX } } });
  await prisma.$disconnect();
});

/**
 * Every admin billing tool, with the roles that may use it (IB-15). `ok` is the
 * status an allowed role sees: billing is disabled in the integration
 * environment, so the two provider-facing tools answer 503 once authorized.
 */
interface Tool {
  readonly name: string;
  readonly allowed: readonly Role[];
  readonly ok: number;
  readonly call: () => Promise<Response>;
}

const VIEWERS = [PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN] as const;
const SUPER_ONLY = [PlatformRole.SUPER_ADMIN] as const;
const DENIED = [PlatformRole.MODERATOR, PlatformRole.USER] as const;

function tools(): Tool[] {
  const { userId, email, subscriptionId, eventId } = scene;
  const controller = BillingAdminController;

  return [
    { name: "health", allowed: VIEWERS, ok: 200, call: () => controller.healthSummary(get(`${BASE}/health`)) },
    { name: "user lookup", allowed: VIEWERS, ok: 200, call: () => controller.lookupUser(get(`${BASE}/users?email=${encodeURIComponent(email)}`)) },
    { name: "explain access", allowed: VIEWERS, ok: 200, call: () => controller.explainUser(get(`${BASE}/users/${userId}/access`), userId) },
    { name: "user timeline", allowed: VIEWERS, ok: 200, call: () => controller.userTimeline(get(`${BASE}/users/${userId}/timeline`), userId) },
    {
      name: "subscription timeline",
      allowed: VIEWERS,
      ok: 200,
      call: () => controller.subscriptionTimeline(get(`${BASE}/subscriptions/${subscriptionId}/timeline`), subscriptionId),
    },
    { name: "anomaly list", allowed: VIEWERS, ok: 200, call: () => controller.listAnomalies(get(`${BASE}/anomalies`)) },
    {
      name: "anomaly detail",
      allowed: VIEWERS,
      ok: 200,
      call: async () => {
        const anomaly = await insertAnomaly(PREFIX, { userId });
        return controller.getAnomaly(get(`${BASE}/anomalies/${anomaly.id}`), anomaly.id);
      },
    },
    {
      name: "raw payload",
      allowed: SUPER_ONLY,
      ok: 200,
      call: () => controller.rawPayload(get(`${BASE}/events/${eventId}/payload`), eventId),
    },
    {
      name: "anomaly resolve",
      allowed: SUPER_ONLY,
      ok: 200,
      call: async () => {
        const anomaly = await insertAnomaly(PREFIX, { userId });
        return controller.resolveAnomaly(post(`${BASE}/anomalies/${anomaly.id}/resolve`, { reason: "handled by support" }), anomaly.id);
      },
    },
    {
      name: "bulk re-sync",
      allowed: SUPER_ONLY,
      ok: 200,
      // A dry run against TEST: authorized and real, without marking rows other suites own.
      call: () =>
        controller.bulkResync(
          post(`${BASE}/resync`, { reason: "matrix check", dryRun: true }),
          new BulkResyncService({ resolvedMode: () => "TEST" }),
        ),
    },
    {
      name: "sync now (Phase IV)",
      allowed: VIEWERS,
      ok: 503,
      call: () => controller.syncSubscription(post(`${BASE}/subscriptions/${subscriptionId}/sync`), subscriptionId),
    },
    {
      name: "admin immediate cancel (Phase VI)",
      allowed: SUPER_ONLY,
      ok: 503,
      call: () =>
        controller.cancelSubscription(
          post(`${BASE}/subscriptions/${subscriptionId}/cancel`, { reason: "matrix check" }, { "idempotency-key": randomUUID() }),
          subscriptionId,
        ),
    },
  ];
}

describe("the authorization matrix for every admin billing tool", () => {
  // Static: the scene (and so `tools()`) does not exist yet when the cases are declared.
  const names = [
    "health",
    "user lookup",
    "explain access",
    "user timeline",
    "subscription timeline",
    "anomaly list",
    "anomaly detail",
    "raw payload",
    "anomaly resolve",
    "bulk re-sync",
    "sync now (Phase IV)",
    "admin immediate cancel (Phase VI)",
  ];

  it("covers every tool", () => {
    // Guards the static list above against drifting from the real one.
    session.actorId = "";
    scene = { userId: "u", email: "e@example.test", subscriptionId: "s", eventId: "ev" };

    expect(tools().map((tool) => tool.name)).toEqual(names);
  });

  it.each(names)("%s: 401 without a session", async (name) => {
    await signInAs(null);
    const tool = tools().find((t) => t.name === name)!;

    const { status, body } = await json(await tool.call());

    expect(status).toBe(401);
    expect(body).toMatchObject({ success: false, error: { code: "UNAUTHORIZED" } });
  });

  it.each(names)("%s: allowed roles get through, everyone else is 403", async (name) => {
    const everyone: Role[] = [PlatformRole.SUPER_ADMIN, PlatformRole.ADMIN, PlatformRole.MODERATOR, PlatformRole.USER];

    for (const role of everyone) {
      await signInAs(role);
      const tool = tools().find((t) => t.name === name)!;
      const { status, body } = await json(await tool.call());

      if (tool.allowed.includes(role)) {
        expect(status, `${name} as ${role}`).toBe(tool.ok);
        expect(body.success).toBe(tool.ok < 400);
      } else {
        expect(status, `${name} as ${role}`).toBe(403);
        expect(body).toMatchObject({ success: false, error: { code: expect.any(String), message: expect.any(String) } });
        expect(JSON.stringify(body)).not.toContain(SECRET);
      }
    }
  });

  it("gives MODERATOR and USER nothing anywhere", async () => {
    for (const role of DENIED) {
      await signInAs(role);

      for (const tool of tools()) {
        expect((await tool.call()).status, `${tool.name} as ${role}`).toBe(403);
      }
    }
  });
});

describe("ADMIN is read-only", () => {
  it("cannot resolve, re-sync, cancel or read a payload, and changes no state", async () => {
    await signInAs(PlatformRole.ADMIN);
    const anomaly = await insertAnomaly(PREFIX, { userId: scene.userId });
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: scene.subscriptionId } });

    const attempts = [
      BillingAdminController.resolveAnomaly(post(`${BASE}/anomalies/${anomaly.id}/resolve`, { reason: "should not work" }), anomaly.id),
      BillingAdminController.bulkResync(
        post(`${BASE}/resync`, { reason: "should not work" }),
        new BulkResyncService({ resolvedMode: () => "TEST" }),
      ),
      BillingAdminController.rawPayload(get(`${BASE}/events/${scene.eventId}/payload`), scene.eventId),
    ];

    for (const response of await Promise.all(attempts)) expect(response.status).toBe(403);

    expect((await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: anomaly.id } })).resolvedAt).toBeNull();
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: scene.subscriptionId } })).toEqual(row);
  });

  it("can diagnose: explain, timeline, anomalies and health", async () => {
    await signInAs(PlatformRole.ADMIN);

    const explain = await json(await BillingAdminController.explainUser(get(`${BASE}/users/${scene.userId}/access`), scene.userId));
    expect(explain.status).toBe(200);
    expect(explain.body.data.permissions).toEqual({ canManageBilling: false, canViewRawPayloads: false });

    const health = await json(await BillingAdminController.healthSummary(get(`${BASE}/health`)));
    expect(health.status).toBe(200);
    expect(health.body.data).toMatchObject({ providerMode: expect.any(String), dueBacklog: expect.any(Array) });
  });
});

describe("SUPER_ADMIN mutations", () => {
  it("resolves an anomaly, and a second resolution is a 409 with a stable code", async () => {
    const boss = await signInAs(PlatformRole.SUPER_ADMIN);
    const anomaly = await insertAnomaly(PREFIX, { userId: scene.userId });
    const url = `${BASE}/anomalies/${anomaly.id}/resolve`;

    const first = await json(await BillingAdminController.resolveAnomaly(post(url, { reason: "cancelled the duplicate" }), anomaly.id));
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ resolutionReason: "cancelled the duplicate", resolvedBy: { id: boss!.id } });

    const second = await json(await BillingAdminController.resolveAnomaly(post(url, { reason: "cancelled it again" }), anomaly.id));
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ success: false, error: { code: "BILLING_ANOMALY_ALREADY_RESOLVED" } });
  });

  it("bulk re-sync marks due for real when the mode is known, and counts on a dry run", async () => {
    await signInAs(PlatformRole.SUPER_ADMIN);
    const service = new BulkResyncService({ resolvedMode: () => "TEST", now: () => new Date("2026-10-01T12:00:00.000Z") });

    const preview = await json(await BillingAdminController.bulkResync(post(`${BASE}/resync`, { reason: "preview", dryRun: true }), service));
    expect(preview.body.data).toMatchObject({ mode: "TEST", dryRun: true, marked: 0 });
    expect(preview.body.data.matched).toBeGreaterThanOrEqual(1);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: scene.subscriptionId } })).syncDueAt).toBeNull();

    const real = await json(await BillingAdminController.bulkResync(post(`${BASE}/resync`, { reason: "for real" }), service));
    expect(real.status).toBe(200);
    expect(real.body.data.marked).toBeGreaterThanOrEqual(1);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: scene.subscriptionId } })).syncReason).toBe("ADMIN");
  });

  it("answers 503 for a bulk re-sync while billing is disabled, marking nothing", async () => {
    await signInAs(PlatformRole.SUPER_ADMIN);

    const { status, body } = await json(await BillingAdminController.bulkResync(post(`${BASE}/resync`, { reason: "billing is off" })));

    expect(status).toBe(503);
    expect(body).toMatchObject({ success: false, error: { code: "BILLING_UNAVAILABLE" } });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: scene.subscriptionId } })).syncDueAt).toBeNull();
  });
});

describe("error envelopes", () => {
  it("validates input with a 4xx envelope before touching anything", async () => {
    await signInAs(PlatformRole.SUPER_ADMIN);
    const anomaly = await insertAnomaly(PREFIX, { userId: scene.userId });
    const resolve = (payload: unknown) =>
      BillingAdminController.resolveAnomaly(post(`${BASE}/anomalies/${anomaly.id}/resolve`, payload), anomaly.id);
    const service = new BulkResyncService({ resolvedMode: () => "TEST" });

    for (const response of [
      await resolve({}),
      await resolve({ reason: "" }),
      await resolve({ reason: "ab" }),
      await resolve({ reason: "long enough", extra: true }),
      await BillingAdminController.bulkResync(post(`${BASE}/resync`, { reason: "ab" }), service),
      await BillingAdminController.bulkResync(post(`${BASE}/resync`, { reason: "fine reason", lastSyncedBefore: "yesterday" }), service),
      await BillingAdminController.bulkResync(post(`${BASE}/resync`, {}), service),
    ]) {
      const { status, body } = await json(response);

      expect(status).toBe(422);
      expect(body).toMatchObject({ success: false, error: { code: expect.any(String), message: expect.any(String) } });
    }

    expect((await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: anomaly.id } })).resolvedAt).toBeNull();
  });

  it("rejects a user lookup by neither or both of id and e-mail", async () => {
    await signInAs(PlatformRole.ADMIN);

    for (const query of ["", `?userId=${scene.userId}&email=${encodeURIComponent(scene.email)}`, "?email=not-an-email"]) {
      expect((await BillingAdminController.lookupUser(get(`${BASE}/users${query}`))).status).toBe(422);
    }
  });

  it("404s unknown subjects with stable codes", async () => {
    await signInAs(PlatformRole.SUPER_ADMIN);
    const missing = `${PREFIX}missing`;

    const cases = [
      [await BillingAdminController.explainUser(get(`${BASE}/users/${missing}/access`), missing), "BILLING_USER_NOT_FOUND"],
      [await BillingAdminController.userTimeline(get(`${BASE}/users/${missing}/timeline`), missing), "BILLING_USER_NOT_FOUND"],
      [await BillingAdminController.subscriptionTimeline(get(`${BASE}/subscriptions/${missing}/timeline`), missing), "BILLING_SUBSCRIPTION_NOT_FOUND"],
      [await BillingAdminController.getAnomaly(get(`${BASE}/anomalies/${missing}`), missing), "BILLING_ANOMALY_NOT_FOUND"],
      [await BillingAdminController.resolveAnomaly(post(`${BASE}/anomalies/${missing}/resolve`, { reason: "no such thing" }), missing), "BILLING_ANOMALY_NOT_FOUND"],
      [await BillingAdminController.rawPayload(get(`${BASE}/events/${missing}/payload`), missing), "BILLING_EVENT_NOT_FOUND"],
      [await BillingAdminController.lookupUser(get(`${BASE}/users?email=${encodeURIComponent(`${PREFIX}nobody@example.test`)}`)), "BILLING_USER_NOT_FOUND"],
    ] as const;

    for (const [response, code] of cases) {
      const { status, body } = await json(response);

      expect(status, code).toBe(404);
      expect(body).toMatchObject({ success: false, error: { code } });
    }
  });
});

describe("raw payloads never leak", () => {
  it("appear only in the SUPER_ADMIN payload response, never in any other admin response", async () => {
    await signInAs(PlatformRole.SUPER_ADMIN);
    await insertAnomaly(PREFIX, { userId: scene.userId });

    const others = tools().filter((tool) => tool.name !== "raw payload" && tool.ok === 200 && tool.allowed.length === 2);
    for (const tool of others) {
      const text = JSON.stringify((await json(await tool.call())).body);

      expect(text, tool.name).not.toContain(SECRET);
    }

    const payload = await BillingAdminController.rawPayload(get(`${BASE}/events/${scene.eventId}/payload`), scene.eventId);
    expect(payload.status).toBe(200);
    expect(payload.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify((await json(payload)).body)).toContain(SECRET);
  });

  it("never reach an ADMIN through any route", async () => {
    await signInAs(PlatformRole.ADMIN);

    for (const tool of tools()) {
      const text = JSON.stringify((await json(await tool.call())).body);

      expect(text, tool.name).not.toContain(SECRET);
    }
  });

  it("never appear in a log, even when a SUPER_ADMIN reads the payload", async () => {
    await signInAs(PlatformRole.SUPER_ADMIN);
    const logs = await captureLogs();

    try {
      for (const tool of tools()) await tool.call();
    } finally {
      logs.stop();
    }

    expect(logs.records.some((r) => r.event === "admin.payload_viewed")).toBe(true);
    expect(logs.text()).not.toContain(SECRET);
  });
});

describe("rate limits", () => {
  it("advertises the read budget on a read", async () => {
    await signInAs(PlatformRole.ADMIN);

    const response = await BillingAdminController.healthSummary(get(`${BASE}/health`));

    expect(response.status).toBe(200);
    expect(response.headers.get("RateLimit-Limit")).toBe("120");
  });

  it("limits writes per user (billing-admin:write): the 61st resolution attempt in an hour is a 429", async () => {
    await signInAs(PlatformRole.SUPER_ADMIN);
    const missing = `${PREFIX}missing`;
    const statuses: number[] = [];

    // The store prunes "expired" counters opportunistically on 1 in 500 increments. On a database session
    // whose time zone is not UTC it compares a naive-UTC `expiresAt` with `NOW()` and can delete a live
    // counter mid-test (a pre-existing quirk of `lib/rate-limit`, unrelated to billing). Pin it off here.
    const random = vi.spyOn(Math, "random").mockReturnValue(0.999);

    try {
      for (let i = 0; i < 61; i += 1) {
        statuses.push(
          (await BillingAdminController.resolveAnomaly(post(`${BASE}/anomalies/${missing}/resolve`, { reason: "rate limit probe" }), missing))
            .status,
        );
      }
    } finally {
      random.mockRestore();
    }

    expect(statuses.slice(0, 60).every((status) => status === 404)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});
