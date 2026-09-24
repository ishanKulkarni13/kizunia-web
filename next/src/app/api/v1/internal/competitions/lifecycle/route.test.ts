/**
 * Regression tests for the internal lifecycle route's secret check.
 *
 * The route previously compared `x-internal-secret` with a plain `!==`,
 * a non-constant-time comparison inconsistent with every sibling internal
 * route (tick, rate-limit/prune, assets/reconcile), all of which use the
 * constant-time `secretEquals` helper. These tests pin the fixed behavior:
 * missing secret, missing header, wrong secret (both equal and unequal
 * length — the length-guard path inside `secretEquals` must not throw),
 * empty header, and success.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockSweep } = vi.hoisted(() => ({
  mockSweep: vi.fn().mockResolvedValue({ updated: 0 }),
}));

vi.mock("@/modules/competitions/backend/lifecycle.service", () => ({
  CompetitionLifecycleService: { runAutomaticSweep: mockSweep },
}));

import { POST } from "./route";

function makeRequest(secretHeader?: string | null) {
  const headers: Record<string, string> = {};
  if (secretHeader !== null && secretHeader !== undefined) {
    headers["x-internal-secret"] = secretHeader;
  }
  return new NextRequest("https://kizunia.test/api/v1/internal/competitions/lifecycle", {
    method: "POST",
    headers,
  });
}

const REAL_SECRET = "correct-horse-battery-staple";

describe("POST /api/v1/internal/competitions/lifecycle — secret check", () => {
  const originalSecret = process.env.INTERNAL_LIFECYCLE_SECRET;

  beforeEach(() => {
    mockSweep.mockClear();
  });

  afterEach(() => {
    process.env.INTERNAL_LIFECYCLE_SECRET = originalSecret;
  });

  it("returns 401 and does not run the sweep when the env var is unset", async () => {
    delete process.env.INTERNAL_LIFECYCLE_SECRET;

    const response = await POST(makeRequest(REAL_SECRET));

    expect(response.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("returns 401 and does not run the sweep when the header is missing", async () => {
    process.env.INTERNAL_LIFECYCLE_SECRET = REAL_SECRET;

    const response = await POST(makeRequest(null));

    expect(response.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong secret of the same length", async () => {
    process.env.INTERNAL_LIFECYCLE_SECRET = REAL_SECRET;

    const wrongSameLength = "x".repeat(REAL_SECRET.length);
    const response = await POST(makeRequest(wrongSameLength));

    expect(response.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("returns 401 (without throwing) for a wrong secret of a different length", async () => {
    process.env.INTERNAL_LIFECYCLE_SECRET = REAL_SECRET;

    const response = await POST(makeRequest("short"));

    expect(response.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("returns 401 for an empty header value against a non-empty secret", async () => {
    process.env.INTERNAL_LIFECYCLE_SECRET = REAL_SECRET;

    const response = await POST(makeRequest(""));

    expect(response.status).toBe(401);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("returns 200 and runs the sweep exactly once for the correct secret", async () => {
    process.env.INTERNAL_LIFECYCLE_SECRET = REAL_SECRET;

    const response = await POST(makeRequest(REAL_SECRET));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(mockSweep).toHaveBeenCalledOnce();
  });
});
