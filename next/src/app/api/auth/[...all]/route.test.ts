/**
 * Regression tests for the auth route's resolveAuthPolicy() path dispatch.
 *
 * resolveAuthPolicy() is a private module function. These tests verify it
 * indirectly by inspecting which rate-limit policy would fire for a given
 * request path, using a tiny inline spy. They are kept focused to the
 * path-policy mapping; Better Auth handler behavior is not under test here.
 *
 * The specific regression this guards: /sign-in/username previously resolved
 * to `null` (no rate limit), leaving the username credential-stuffing surface
 * completely unprotected. The fix wires it to AUTH_SIGN_IN alongside
 * /sign-in/email.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { RateLimitPolicyId } from "@/lib/rate-limit/policies";

// ---------------------------------------------------------------------------
// We can't import resolveAuthPolicy directly (it's module-private), so we
// test it by observing which policyId is passed to rateLimitService.enforce.
// We mock the service before importing the route so the mock is in place.
// ---------------------------------------------------------------------------

const { mockEnforce } = vi.hoisted(() => ({
  mockEnforce: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@/lib/rate-limit/service", () => ({
  rateLimitService: { enforce: mockEnforce },
}));

// Better Auth's handler — not under test; stub it out so no DB is needed.
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({
    GET: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    POST: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: {} }));

// eslint-disable-next-line import/first
import { POST } from "./route";

function makePostRequest(pathname: string): import("next/server").NextRequest {
  const { NextRequest } = require("next/server");
  return new NextRequest(`https://kizunia.test${pathname}`, {
    method: "POST",
    headers: {
      "x-real-ip": "203.0.113.1",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: "user@example.com", password: "hunter2" }),
  });
}

describe("resolveAuthPolicy — path → policy mapping", () => {
  beforeEach(() => {
    mockEnforce.mockClear();
    mockEnforce.mockResolvedValue({ allowed: true });
  });

  it("applies AUTH_SIGN_IN to /sign-in/email", async () => {
    await POST(makePostRequest("/api/auth/sign-in/email"));

    expect(mockEnforce).toHaveBeenCalledOnce();
    expect(mockEnforce.mock.calls[0][0].policyId).toBe(
      RateLimitPolicyId.AUTH_SIGN_IN,
    );
  });

  it("applies AUTH_SIGN_IN to /sign-in/username (regression: was previously unprotected)", async () => {
    await POST(makePostRequest("/api/auth/sign-in/username"));

    expect(mockEnforce).toHaveBeenCalledOnce();
    expect(mockEnforce.mock.calls[0][0].policyId).toBe(
      RateLimitPolicyId.AUTH_SIGN_IN,
    );
  });

  it("applies AUTH_SIGN_UP to /sign-up/email", async () => {
    await POST(makePostRequest("/api/auth/sign-up/email"));

    expect(mockEnforce).toHaveBeenCalledOnce();
    expect(mockEnforce.mock.calls[0][0].policyId).toBe(
      RateLimitPolicyId.AUTH_SIGN_UP,
    );
  });

  it("applies AUTH_PASSWORD_RESET_REQUEST to /request-password-reset", async () => {
    await POST(makePostRequest("/api/auth/request-password-reset"));

    expect(mockEnforce).toHaveBeenCalledOnce();
    expect(mockEnforce.mock.calls[0][0].policyId).toBe(
      RateLimitPolicyId.AUTH_PASSWORD_RESET_REQUEST,
    );
  });

  it("does not rate-limit unrelated Better Auth POST paths (e.g. /sign-out)", async () => {
    await POST(makePostRequest("/api/auth/sign-out"));

    expect(mockEnforce).not.toHaveBeenCalled();
  });

  it("does not rate-limit OAuth callback paths", async () => {
    await POST(makePostRequest("/api/auth/callback/google"));

    expect(mockEnforce).not.toHaveBeenCalled();
  });
});
