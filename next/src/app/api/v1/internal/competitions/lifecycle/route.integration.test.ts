/**
 * Verifies this route's logging: `competitions.lifecycle.sweep_unauthorized`
 * on a bad/missing secret, and `competitions.lifecycle.sweep_completed` with
 * a summary reflecting what the sweep actually did on success — through the
 * real logger sink, not an assertion that `logger.*` was merely called.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { CompetitionStatus, CompetitionVisibility } from "@/generated/prisma";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";

import { POST } from "./route";

const TEST_SLUG_PREFIX = "__vitest_lifecycle_route_test__";
const SECRET = "test-internal-lifecycle-secret";

function testSlug(name: string): string {
  return `${TEST_SLUG_PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function captureSink() {
  const records: LogRecord[] = [];
  setLogSink((record) => {
    records.push(record);
  });
  return records;
}

function makeRequest(secret: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (secret !== null) {
    headers["x-internal-secret"] = secret;
  }
  return new NextRequest("https://kizunia.test/api/v1/internal/competitions/lifecycle", {
    method: "POST",
    headers,
  });
}

afterEach(() => {
  resetLogSink();
  delete process.env.INTERNAL_LIFECYCLE_SECRET;
});

afterAll(async () => {
  await prisma.competition.deleteMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("POST /api/v1/internal/competitions/lifecycle — logging", () => {
  it("logs sweep_unauthorized and does not run the sweep when the secret is wrong", async () => {
    process.env.INTERNAL_LIFECYCLE_SECRET = SECRET;
    const records = captureSink();

    const response = await POST(makeRequest("wrong-secret"));

    expect(response.status).toBe(401);
    const event = records.find(
      (record) => record.event === "competitions.lifecycle.sweep_unauthorized",
    );
    expect(event).toBeDefined();
    expect(event?.level).toBe("warn");
    expect(
      records.some((record) => record.event === "competitions.lifecycle.sweep_completed"),
    ).toBe(false);
  });

  it("logs a completion summary matching the rows the sweep actually changed", async () => {
    process.env.INTERNAL_LIFECYCLE_SECRET = SECRET;

    const past = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.competition.create({
      data: {
        title: "Sweep Route Logging Test Competition",
        slug: testSlug("completes"),
        visibility: CompetitionVisibility.PUBLIC,
        status: CompetitionStatus.ONGOING,
        endDate: past,
        automaticStatusUpdatesDisabled: false,
      },
    });

    const records = captureSink();

    const response = await POST(makeRequest(SECRET));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { scanned: number; changed: number; byTransition: Record<string, number> };
    };

    const event = records.find(
      (record) => record.event === "competitions.lifecycle.sweep_completed",
    );
    expect(event).toBeDefined();
    expect(event?.level).toBe("info");
    expect(event?.fields).toEqual({
      scanned: body.data.scanned,
      changed: body.data.changed,
      byTransition: body.data.byTransition,
    });
    expect(body.data.changed).toBeGreaterThanOrEqual(1);
    expect(body.data.byTransition["ONGOING->COMPLETED"]).toBeGreaterThanOrEqual(1);
  });
});
