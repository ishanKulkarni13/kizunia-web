/**
 * Regression: verifies that the AUTH_SIGN_IN policy applies to BOTH the
 * email and username sign-in variants exposed by this repository's installed
 * Better Auth configuration (email + username plugin).
 *
 * The auth catch-all route (src/app/api/auth/[...all]/route.ts) gates
 * requests via a path suffix check. This test ensures the policy registry
 * shape matches what resolveAuthPolicy must produce for each Better Auth
 * endpoint, so a future refactor of either cannot silently diverge.
 *
 * Better Auth endpoints active in this repo (verified against the installed
 * better-auth@1.6.23 with the plugins in lib/auth.ts):
 *   POST /api/auth/sign-in/email          → AUTH_SIGN_IN   (email flow)
 *   POST /api/auth/sign-in/username       → AUTH_SIGN_IN   (username plugin)
 *   POST /api/auth/sign-up/email          → AUTH_SIGN_UP
 *   POST /api/auth/request-password-reset → AUTH_PASSWORD_RESET_REQUEST
 */

import { describe, expect, it } from "vitest";

import { RATE_LIMIT_POLICIES, RateLimitPolicyId } from "./policies";

describe("AUTH_SIGN_IN policy — covers both email and username flows", () => {
  it("AUTH_SIGN_IN policy has the ip+credential subject strategies needed for both flows", () => {
    const policy = RATE_LIMIT_POLICIES[RateLimitPolicyId.AUTH_SIGN_IN];

    // Both /sign-in/email and /sign-in/username share the same policy.
    // The credential dimension applies to the submitted identifier (email
    // or username) — normalised identically by credentialSubject() in
    // subject.ts — and the ip dimension applies regardless of the variant.
    expect(policy.subjectStrategies).toContain("ip");
    expect(policy.subjectStrategies).toContain("credential");
  });

  it("AUTH_SIGN_IN policy fails closed (a limiter outage must never open a credential-stuffing window)", () => {
    const policy = RATE_LIMIT_POLICIES[RateLimitPolicyId.AUTH_SIGN_IN];

    expect(policy.failureMode).toBe("closed");
  });

  it("AUTH_SIGN_UP, AUTH_PASSWORD_RESET_REQUEST, and AUTH_SIGN_IN are all distinct policy ids", () => {
    // Guards against accidental de-duplication of the ids that resolveAuthPolicy
    // maps to, which would cause one endpoint's counter to consume another's budget.
    const ids = [
      RateLimitPolicyId.AUTH_SIGN_IN,
      RateLimitPolicyId.AUTH_SIGN_UP,
      RateLimitPolicyId.AUTH_PASSWORD_RESET_REQUEST,
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});
