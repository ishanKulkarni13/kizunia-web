/**
 * The manual `billing:payload-prune` route: the internal-job convention
 * (`Authorization: Bearer <CRON_SECRET>`, 401 otherwise) and the run itself.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { insertBillingEvent } from "@/testing/billing-admin-fixtures";
import { cleanupBillingUsers } from "@/testing/billing-sync-fixtures";

import { GET } from "./route";

const PREFIX = "__vitest_billing_prune_route__";
const SECRET = "test-cron-secret";

let savedSecret: string | undefined;

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/v1/internal/billing/payload-prune", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
});
afterEach(async () => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;

  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("GET /api/v1/internal/billing/payload-prune", () => {
  it.each([[undefined], ["Bearer wrong"], [SECRET], ["Basic abc"]])("401s the authorization %j and prunes nothing", async (header) => {
    const old = await insertBillingEvent(PREFIX, { receivedAt: new Date("2000-01-01T00:00:00.000Z") });

    const response = await GET(request(header));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "UNAUTHORIZED" } });
    const [row] = await prisma.$queryRaw<{ hasPayload: boolean }[]>`
      SELECT ("rawPayload" IS NOT NULL) AS "hasPayload" FROM "public"."billing_event" WHERE "id" = ${old.id}`;
    expect(row.hasPayload).toBe(true);
  });

  it("401s when CRON_SECRET is not configured, even for an empty bearer", async () => {
    delete process.env.CRON_SECRET;

    expect((await GET(request("Bearer "))).status).toBe(401);
    expect((await GET(request("Bearer undefined"))).status).toBe(401);
  });

  it("runs the task with the secret and reports the result", async () => {
    const old = await insertBillingEvent(PREFIX, { receivedAt: new Date("2000-01-01T00:00:00.000Z") });

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { stoppedBy: expect.any(String) } });
    expect(body.data.pruned).toBeGreaterThanOrEqual(1);

    const [row] = await prisma.$queryRaw<{ hasPayload: boolean }[]>`
      SELECT ("rawPayload" IS NOT NULL) AS "hasPayload" FROM "public"."billing_event" WHERE "id" = ${old.id}`;
    expect(row.hasPayload).toBe(false);
    // The row itself is still there.
    expect(await prisma.billingEvent.findUnique({ where: { id: old.id } })).not.toBeNull();
  });
});
