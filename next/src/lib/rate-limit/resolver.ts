/**
 * Policy Resolver — turns a policy id (+ subject + entitlements) into the
 * limit that actually applies.
 *
 * V1 body: look up the registry entry and return it unchanged. That is the
 * whole implementation, and that is deliberate — the value of this function
 * existing at all is that FUTURE overrides (a custom enterprise contract, an
 * organization-level limit, a plan tier) attach here, behind this one
 * signature, without any caller ever learning that plans, organizations, or
 * custom limits exist. See `Entitlements` in `lib/entitlements`.
 *
 * Precedence a future override layer would add, most specific first:
 * per-subject custom override → organization override → plan-tier override
 * → this registry default. None of that exists yet; only the default path
 * is implemented.
 */

import type { Entitlements } from "@/lib/entitlements";

import { RATE_LIMIT_POLICIES, type RateLimitPolicy, type RateLimitPolicyId } from "./policies";
import type { RateLimitSubject } from "./subject";

export interface EffectiveRateLimit {
  readonly limit: number;
  readonly windowSeconds: number;
  readonly failureMode: RateLimitPolicy["failureMode"];
  readonly subjectStrategies: RateLimitPolicy["subjectStrategies"];
}

export function resolvePolicy(
  policyId: RateLimitPolicyId,
  // Reserved for the future override layer described above. Unused in V1;
  // named (not `_subject`) so the day it is read, nothing about the
  // signature needs to change.
  subject: RateLimitSubject,
  // Same: threaded through today so entitlement-aware overrides are a body
  // change here, not a signature change everywhere this is called.
  entitlements: Entitlements,
): EffectiveRateLimit {
  void subject;
  void entitlements;

  const policy = RATE_LIMIT_POLICIES[policyId];

  if (!policy) {
    // Reachable only past a type cast (`policyId` is a closed union), but
    // this is exactly the situation where failing loudly matters most — a
    // silent `undefined.limit` crash here would be far harder to diagnose
    // than this message.
    throw new Error(`Unknown rate limit policy id: "${policyId}".`);
  }

  return {
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
    failureMode: policy.failureMode,
    subjectStrategies: policy.subjectStrategies,
  };
}
