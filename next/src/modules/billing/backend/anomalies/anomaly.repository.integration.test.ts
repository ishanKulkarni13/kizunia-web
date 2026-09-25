/**
 * Anomalies are an upsert on the open row: one open anomaly per (type, subject),
 * safe under concurrency, re-openable once resolved.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";

import { AnomalySubject, BillingAnomalyRepository } from "./anomaly.repository";

const PREFIX = "__vitest_billing_anomaly__";
const NOW = new Date("2026-10-01T12:00:00.000Z");
const LATER = new Date("2026-10-01T13:00:00.000Z");

function subject(name: string) {
  return AnomalySubject.providerSubscription(`${PREFIX}${name}-${Date.now()}-${Math.random()}`);
}

async function cleanup() {
  await prisma.billingAnomaly.deleteMany({ where: { subjectKey: { contains: PREFIX } } });
}

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("BillingAnomalyRepository.raise", () => {
  it("opens an anomaly, then counts a repeat on the same open row", async () => {
    const key = subject("repeat");
    const first = await BillingAnomalyRepository.raise(
      prisma,
      {
        type: "PROVIDER_SUBSCRIPTION_MISSING",
        providerMode: "TEST",
        subjectKey: key,
        subscriptionIds: ["s1"],
        providerSubscriptionId: "sub_x",
        details: { failureClass: "REJECTED" },
      },
      NOW,
    );
    const second = await BillingAnomalyRepository.raise(
      prisma,
      {
        type: "PROVIDER_SUBSCRIPTION_MISSING",
        providerMode: "TEST",
        subjectKey: key,
        subscriptionIds: ["s1", "s2"],
        details: { failureClass: "NOT_FOUND" },
      },
      LATER,
    );

    expect(first).toMatchObject({ opened: true, occurrences: 1 });
    expect(second).toMatchObject({ id: first.id, opened: false, occurrences: 2 });

    const row = await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: first.id } });
    expect(row).toMatchObject({
      type: "PROVIDER_SUBSCRIPTION_MISSING",
      providerMode: "TEST",
      providerSubscriptionId: "sub_x",
      occurrences: 2,
      firstSeenAt: NOW,
      lastSeenAt: LATER,
      details: { failureClass: "NOT_FOUND" },
      resolvedAt: null,
    });
    expect([...row.subscriptionIds].sort()).toEqual(["s1", "s2"]);
  });

  it("keeps one open row under concurrent raises", async () => {
    const key = subject("concurrent");
    const input = { type: "NOTES_CONFLICT" as const, providerMode: "TEST" as const, subjectKey: key, details: {} };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => BillingAnomalyRepository.raise(prisma, input, NOW)),
    );

    expect(results.filter((r) => r.opened)).toHaveLength(1);
    expect(await prisma.billingAnomaly.count({ where: { subjectKey: key } })).toBe(1);
    expect((await prisma.billingAnomaly.findFirstOrThrow({ where: { subjectKey: key } })).occurrences).toBe(5);
  });

  it("opens a fresh row after the open one is resolved", async () => {
    const key = subject("reopen");
    const input = {
      type: "UNMAPPED_PROVIDER_PLAN" as const,
      providerMode: "TEST" as const,
      subjectKey: key,
      details: { providerPlanId: "plan_x" },
    };

    const first = await BillingAnomalyRepository.raise(prisma, input, NOW);
    expect(await BillingAnomalyRepository.resolveOpen(prisma, "UNMAPPED_PROVIDER_PLAN", key, "AUTO: test", LATER)).toBe(
      true,
    );
    expect(await BillingAnomalyRepository.resolveOpen(prisma, "UNMAPPED_PROVIDER_PLAN", key, "again", LATER)).toBe(
      false,
    );

    const second = await BillingAnomalyRepository.raise(prisma, input, LATER);

    expect(second.opened).toBe(true);
    expect(second.id).not.toBe(first.id);
    expect(await prisma.billingAnomaly.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      resolvedAt: LATER,
      resolutionReason: "AUTO: test",
    });
  });

  it("keeps the same subject under different types apart", async () => {
    const key = subject("types");

    const a = await BillingAnomalyRepository.raise(
      prisma,
      { type: "TERMINAL_STATE_CONTRADICTED", providerMode: "TEST", subjectKey: key, details: {} },
      NOW,
    );
    const b = await BillingAnomalyRepository.raise(
      prisma,
      { type: "PROVIDER_MODE_MISMATCH", providerMode: "TEST", subjectKey: key, details: {} },
      NOW,
    );

    expect(a.opened && b.opened).toBe(true);
    expect(a.id).not.toBe(b.id);
  });

  it("refuses a type outside the enum before any SQL runs", async () => {
    await expect(
      BillingAnomalyRepository.raise(
        prisma,
        { type: "'; DROP TABLE x; --" as never, providerMode: "TEST", subjectKey: subject("bad"), details: {} },
        NOW,
      ),
    ).rejects.toThrow(/not a BillingAnomalyType/);
  });
});
