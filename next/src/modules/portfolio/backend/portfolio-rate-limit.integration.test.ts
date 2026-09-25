/**
 * Portfolio rate limiting, end to end: the real controller, the real limiter
 * and the real Postgres store, with only the session mocked. Confirms an
 * authenticated Portfolio route is actually throttled per user, and that the
 * rejection follows the repository's conventions (429, stable error code,
 * Retry-After and RateLimit-* headers).
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/prisma";
import {
  RATE_LIMIT_POLICIES,
  RateLimitPolicyId,
} from "@/lib/rate-limit/policies";

const { session } = vi.hoisted(() => ({
  session: { actorId: "" },
}));

vi.mock("@/lib/auth/session", () => ({
  SessionService: {
    getStrictActor: vi.fn(async () => ({
      id: session.actorId,
      role: "user",
      banned: false,
    })),
  },
}));

import { deleteGrantsForEmailPrefix, grantPlanWithFixtureGranter } from "@/testing/entitlement-fixtures";
import { PortfolioController } from "./controller";

const TEST_PREFIX = "__vitest_portfolio_rate_limit__";

let counter = 0;

async function createUser(name: string) {
  counter += 1;
  const key = `${TEST_PREFIX}_${name}_${Date.now()}_${counter}`;

  const user = await prisma.user.create({
    data: {
      id: key,
      name: "Rate Limit Test User",
      email: `${key}@example.test`,
      emailVerified: true,
      username: key.toLowerCase(),
    },
  });

  // Rate limiting is the subject here, not entitlements: the user may create
  // portfolios, through a real grant.
  await grantPlanWithFixtureGranter(user.id, "PRO", TEST_PREFIX);

  return user;
}

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/portfolio", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  session.actorId = "";
});

afterAll(async () => {
  await prisma.portfolio.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await deleteGrantsForEmailPrefix(TEST_PREFIX);
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.rateLimit.deleteMany({
    where: { key: { contains: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("PORTFOLIO_CREATE", () => {
  it("throttles per user with the standard 429 contract", async () => {
    const user = await createUser("create");
    session.actorId = user.id;

    const { limit } = RATE_LIMIT_POLICIES[RateLimitPolicyId.PORTFOLIO_CREATE];

    // First call creates the portfolio; the rest are 409s (the unique
    // constraint) — but every one of them spends the budget.
    const first = await PortfolioController.create(request("POST"));
    expect(first.status).toBe(201);
    expect(first.headers.get("RateLimit-Limit")).toBe(String(limit));

    for (let i = 1; i < limit; i++) {
      const response = await PortfolioController.create(request("POST"));
      expect(response.status).toBe(409);
    }

    const limited = await PortfolioController.create(request("POST"));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
    expect(limited.headers.get("RateLimit-Remaining")).toBe("0");

    const body = await limited.json();
    expect(body).toMatchObject({
      success: false,
      error: {
        code: "PORTFOLIO_CREATE_RATE_LIMITED",
        category: "rate_limit",
        retryable: true,
      },
    });
  });

  it("keeps each user's budget separate", async () => {
    const heavy = await createUser("heavy");
    const other = await createUser("other");

    const { limit } = RATE_LIMIT_POLICIES[RateLimitPolicyId.PORTFOLIO_CREATE];

    session.actorId = heavy.id;
    for (let i = 0; i <= limit; i++) {
      await PortfolioController.create(request("POST"));
    }

    session.actorId = other.id;
    const response = await PortfolioController.create(request("POST"));

    expect(response.status).toBe(201);
  });
});

describe("read and write policies are independent", () => {
  it("exhausting a write policy does not throttle the owner's reads", async () => {
    const user = await createUser("independent");
    session.actorId = user.id;

    await PortfolioController.create(request("POST"));

    const { limit } =
      RATE_LIMIT_POLICIES[RateLimitPolicyId.PORTFOLIO_LIFECYCLE_WRITE];

    for (let i = 0; i <= limit; i++) {
      await PortfolioController.changeVisibility(
        request("PATCH", { visibility: "PRIVATE" }),
      );
    }

    const limitedWrite = await PortfolioController.changeVisibility(
      request("PATCH", { visibility: "PRIVATE" }),
    );
    expect(limitedWrite.status).toBe(429);

    const read = await PortfolioController.findMine(request("GET"));
    expect(read.status).toBe(200);
  });

  it("gives reads a higher ceiling than profile writes", () => {
    expect(
      RATE_LIMIT_POLICIES[RateLimitPolicyId.PORTFOLIO_READ_OWN].limit,
    ).toBeGreaterThan(
      RATE_LIMIT_POLICIES[RateLimitPolicyId.PORTFOLIO_PROFILE_WRITE].limit,
    );
  });
});

describe("policy registry", () => {
  it("declares every Portfolio policy as user-keyed and fail-open (local DB cost only)", () => {
    const portfolioPolicies = Object.values(RATE_LIMIT_POLICIES).filter(
      (policy) =>
        policy.id.startsWith("portfolio:") &&
        policy.id !== RateLimitPolicyId.PORTFOLIO_READ_PUBLIC,
    );

    expect(portfolioPolicies).toHaveLength(7);

    for (const policy of portfolioPolicies) {
      expect(policy.subjectStrategies).toEqual(["user"]);
      expect(policy.failureMode).toBe("open");
    }
  });
});
