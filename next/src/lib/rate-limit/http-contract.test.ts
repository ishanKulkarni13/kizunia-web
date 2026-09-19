import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { ErrorHandler } from "@/lib/errors";
import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";

import { InMemoryRateLimitStore } from "./memory.store";
import { RateLimitPolicyId } from "./policies";
import { RateLimitService } from "./service";

function request(ip = "203.0.113.20"): Request {
  return new Request("https://kizunia.test/api/v1/example", {
    headers: { "x-real-ip": ip },
  });
}

describe("HTTP contract — 429 rejection", () => {
  it("ErrorHandler renders Retry-After and RateLimit-* headers, and a consistent error body", async () => {
    const service = new RateLimitService(new InMemoryRateLimitStore());
    const input = { policyId: RateLimitPolicyId.AUTH_SIGN_UP, request: request() };

    for (let i = 0; i < 20; i++) {
      await service.enforce(input);
    }

    let thrown: unknown;

    try {
      await service.enforce(input);
    } catch (error) {
      thrown = error;
    }

    const response = ErrorHandler.handle(thrown);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(response.headers.get("RateLimit-Limit")).toBe("20");
    expect(response.headers.get("RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("RateLimit-Reset")).not.toBeNull();

    const body = await response.json();

    expect(body).toMatchObject({
      success: false,
      error: {
        code: "AUTH_SIGN_UP_RATE_LIMITED",
        category: "rate_limit",
        retryable: true,
      },
    });
    expect(body.error.details).toMatchObject({ limit: 20, remaining: 0 });
  });
});

describe("HTTP contract — 200 success", () => {
  it("Route.execute attaches RateLimit-* headers to a successful response", async () => {
    const service = new RateLimitService(new InMemoryRateLimitStore());

    const response = await Route.execute(async () => {
      await service.check({
        policyId: RateLimitPolicyId.TAXONOMY_CATEGORIES,
        request: request(),
      });

      return ApiResponse.ok({ ok: true });
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("RateLimit-Limit")).toBe("120");
    expect(response.headers.get("RateLimit-Remaining")).toBe("119");
    expect(response.headers.get("RateLimit-Reset")).not.toBeNull();
  });

  it("Route.execute attaches no RateLimit-* headers when no check ran", async () => {
    const response = await Route.execute(async () => NextResponse.json({ ok: true }));

    expect(response.headers.get("RateLimit-Limit")).toBeNull();
  });

  it("Route.execute's catch path renders 429 headers via ErrorHandler when a handler rejects", async () => {
    const service = new RateLimitService(new InMemoryRateLimitStore());
    const policyId = RateLimitPolicyId.AUTH_SIGN_UP;
    const input = { policyId, request: request("203.0.113.99") };

    for (let i = 0; i < 20; i++) {
      await service.enforce(input);
    }

    const response = await Route.execute(async () => {
      await service.enforce(input);

      return ApiResponse.ok({ ok: true });
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(response.headers.get("RateLimit-Remaining")).toBe("0");
  });
});
