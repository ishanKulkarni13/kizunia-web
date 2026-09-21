/**
 * Verifies SessionService's logging behavior through the real logger sink,
 * not by mocking logger calls. Only `@/lib/auth` (the Better Auth `auth`
 * object) is mocked, the same boundary `app/api/auth/[...all]/route.test.ts`
 * already mocks at — `auth.api.getSession` is the one call this service
 * makes that would otherwise require a real session/cookie.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mockGetSession } },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

import { SessionService } from "./session";

function captureSink() {
  const records: LogRecord[] = [];
  setLogSink((record) => {
    records.push(record);
  });
  return records;
}

function makeRequest(): NextRequest {
  return new NextRequest("https://kizunia.test/api/v1/competitions", {
    headers: { cookie: "session=x" },
  });
}

afterEach(() => {
  resetLogSink();
  mockGetSession.mockReset();
});

describe("SessionService — logging", () => {
  it("getActor logs auth.session_rejected and throws when no session exists", async () => {
    mockGetSession.mockResolvedValue(null);
    const records = captureSink();

    await expect(SessionService.getActor(makeRequest())).rejects.toThrow();

    const event = records.find((record) => record.event === "auth.session_rejected");
    expect(event).toBeDefined();
    expect(event?.level).toBe("warn");
  });

  it("getActor stays silent on a successful session resolution", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u1", role: "user", banned: false },
    });
    const records = captureSink();

    await SessionService.getActor(makeRequest());

    expect(records.some((record) => record.event === "auth.session_rejected")).toBe(false);
    expect(
      records.some((record) => record.event === "auth.strict_actor_incomplete"),
    ).toBe(false);
  });

  it("getStrictActor logs auth.strict_actor_incomplete and throws when the actor shape is incomplete", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u1", role: null, banned: false },
    });
    const records = captureSink();

    await expect(SessionService.getStrictActor(makeRequest())).rejects.toThrow();

    const event = records.find(
      (record) => record.event === "auth.strict_actor_incomplete",
    );
    expect(event).toBeDefined();
    expect(event?.level).toBe("warn");
  });

  it("getOptionalActor returns null without logging auth.session_rejected", async () => {
    mockGetSession.mockResolvedValue(null);
    const records = captureSink();

    const actor = await SessionService.getOptionalActor(makeRequest());

    expect(actor).toBeNull();
    expect(records.some((record) => record.event === "auth.session_rejected")).toBe(false);
  });
});
