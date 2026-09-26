/**
 * Raw payload view (Phase VIII): SUPER_ADMIN only — never ADMIN, MODERATOR or
 * USER — and logged with the actor and event id, never the content.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { PlatformRole } from "@/authorization";
import { ForbiddenError } from "@/lib/errors";
import prisma from "@/lib/prisma";
import { actorWithRole, captureLogs, insertBillingEvent } from "@/testing/billing-admin-fixtures";
import { cleanupBillingUsers } from "@/testing/billing-sync-fixtures";

import { BillingEventNotFoundError } from "../../errors";
import { AdminPayloadService } from "./payload.service";

const PREFIX = "__vitest_billing_admin_payload__";
const SECRET = "SENTINEL-payload-7c1e@example.test";

const service = new AdminPayloadService();

afterEach(async () => {
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("AdminPayloadService.rawPayload", () => {
  it("returns the payload to a SUPER_ADMIN and logs the view without the content", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const event = await insertBillingEvent(PREFIX, { rawPayload: { payload: { customer_email: SECRET } } });
    const logs = await captureLogs();

    let result;
    try {
      result = await service.rawPayload(superAdmin, event.id);
    } finally {
      logs.stop();
    }

    expect(result).toEqual({ billingEventId: event.id, pruned: false, payload: { payload: { customer_email: SECRET } } });
    expect(logs.records.map((r) => r.event)).toContain("admin.payload_viewed");
    expect(logs.records.find((r) => r.event === "admin.payload_viewed")?.fields).toMatchObject({
      actorUserId: superAdmin.id,
      billingEventId: event.id,
    });
    expect(logs.text()).not.toContain(SECRET);
  });

  it("refuses ADMIN, MODERATOR and USER", async () => {
    const event = await insertBillingEvent(PREFIX, { rawPayload: { payload: { customer_email: SECRET } } });

    for (const role of [PlatformRole.ADMIN, PlatformRole.MODERATOR, PlatformRole.USER]) {
      await expect(service.rawPayload(await actorWithRole(PREFIX, role), event.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it("says a pruned payload is gone, and 404s an unknown event", async () => {
    const superAdmin = await actorWithRole(PREFIX, PlatformRole.SUPER_ADMIN);
    const prunedAt = new Date("2026-09-10T00:00:00.000Z");
    const event = await insertBillingEvent(PREFIX, { payloadPrunedAt: prunedAt });
    await prisma.$executeRaw`UPDATE "public"."billing_event" SET "rawPayload" = NULL WHERE "id" = ${event.id}`;

    await expect(service.rawPayload(superAdmin, event.id)).resolves.toEqual({
      billingEventId: event.id,
      pruned: true,
      prunedAt: prunedAt.toISOString(),
    });
    await expect(service.rawPayload(superAdmin, `${PREFIX}missing`)).rejects.toBeInstanceOf(
      BillingEventNotFoundError,
    );
  });
});
