/**
 * RateLimitService — the enforcement facade.
 *
 * Orchestrates: resolve policy → resolve subject(s) → count → decide →
 * emit an observability event → return a decision (or throw). This is the
 * one thing a controller talks to; it owns the failure-mode dispatch, the
 * `RateLimitError` construction, and deriving a stable error code from the
 * policy id so codes can never drift out of sync with the policy that
 * produced them, the way the four original call sites' hand-written codes
 * had started to.
 *
 * Must NOT own: HTTP response construction (that is `Route.execute` and
 * `ErrorHandler`, see route.ts / error-handler.ts), storage details (that
 * is `RateLimitStore`), or business rules (that stays in the domain
 * service/controller calling this).
 */

import { RateLimitError } from "@/lib/errors";
import type { Entitlements } from "@/lib/entitlements";
import { resolveEntitlements } from "@/lib/entitlements";

import { emitRateLimitEvent } from "./events";
import type { RateLimitPolicyId } from "./policies";
import { resolvePolicy } from "./resolver";
import { recordRateLimitDecision } from "./response-context";
import {
  encodeSubjectSegment,
  globalSubject,
  resolveSubjectsForStrategies,
  type RateLimitSubject,
} from "./subject";
import { PostgresRateLimitStore } from "./postgres.store";
import type { RateLimitStore } from "./store";

export interface RateLimitCheckInput {
  readonly policyId: RateLimitPolicyId;
  /** Only required for policies using the "ip" or "user-or-ip" subject strategies. */
  readonly request?: Request;
  readonly actor?: { id: string | null | undefined } | null;
  /** Required only for policies using the "credential" subject strategy. */
  readonly credential?: string | null;
  readonly entitlements?: Entitlements;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  /** Lowest remaining count across every subject dimension the policy checks. */
  readonly remaining: number;
  /** Seconds until the current window ends. Backs both `RateLimit-Reset` and, when rejected, `Retry-After`. */
  readonly resetSeconds: number;
  readonly policyId: RateLimitPolicyId;
}

function buildKey(
  policyId: RateLimitPolicyId,
  subject: RateLimitSubject,
  windowStart: number,
): string {
  return `${policyId}:${subject.kind}:${encodeSubjectSegment(subject.id)}:${windowStart}`;
}

/** Derives a stable, policy-tied error code, e.g. "places:autocomplete" → "PLACES_AUTOCOMPLETE_RATE_LIMITED". */
function errorCodeForPolicy(policyId: RateLimitPolicyId): string {
  return `${policyId.replace(/[:-]/g, "_").toUpperCase()}_RATE_LIMITED`;
}

export class RateLimitService {
  constructor(private readonly store: RateLimitStore) {}

  /**
   * Runs the check and returns the decision without throwing, allowed or
   * not. Use this when the caller wants to attach headers to a response
   * itself; use `enforce` when a rejection should short-circuit the request.
   *
   * Every decision this produces is also recorded on the current request's
   * `AsyncLocalStorage` context (see response-context.ts), so `Route.execute`
   * can attach `RateLimit-*` headers to a 200 response without the caller
   * doing anything extra.
   */
  async check(input: RateLimitCheckInput): Promise<RateLimitDecision> {
    const decision = await this.decide(input);

    recordRateLimitDecision(decision);

    return decision;
  }

  private async decide(input: RateLimitCheckInput): Promise<RateLimitDecision> {
    const entitlements = input.entitlements ?? resolveEntitlements();

    // `resolvePolicy` takes a subject purely as a FUTURE seam (a per-
    // subject override), unused by the V1 body — see resolver.ts. Passing
    // a cheap placeholder here avoids resolving a real subject twice, once
    // for this call and once for the actual per-dimension counting below.
    const policy = resolvePolicy(input.policyId, globalSubject(), entitlements);

    const subjects = resolveSubjectsForStrategies(policy.subjectStrategies, {
      request: input.request,
      actor: input.actor,
      credential: input.credential,
    });

    const windowMs = policy.windowSeconds * 1_000;
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const expiresAt = new Date(windowStart + windowMs);
    const resetSeconds = Math.max(
      1,
      Math.ceil((expiresAt.getTime() - now) / 1_000),
    );

    let counts: number[];

    try {
      counts = await Promise.all(
        subjects.map((subject) =>
          this.store
            .increment(buildKey(input.policyId, subject, windowStart), expiresAt)
            .then((result) => result.count),
        ),
      );
    } catch (error) {
      const failedOpen = policy.failureMode === "open";

      emitRateLimitEvent({
        name: failedOpen ? "rate_limit.failed_open" : "rate_limit.failed_closed",
        policyId: input.policyId,
        subjectKind: subjects[0]!.kind,
      });

      if (failedOpen) {
        return {
          allowed: true,
          limit: policy.limit,
          remaining: policy.limit,
          resetSeconds,
          policyId: input.policyId,
        };
      }

      // Fails closed: a store outage is reported as a rejection, not as an
      // unrelated 500 — the caller (`enforce`, or the request layer reading
      // this decision directly) applies the same 429 semantics it would for
      // an ordinary limit breach. `error` is deliberately not rethrown; it
      // is fully handled by failing this check closed.
      void error;

      return {
        allowed: false,
        limit: policy.limit,
        remaining: 0,
        resetSeconds,
        policyId: input.policyId,
      };
    }

    const worstCount = Math.max(...counts);
    const remaining = Math.max(0, policy.limit - worstCount);
    const allowed = worstCount <= policy.limit;

    emitRateLimitEvent({
      name: allowed ? "rate_limit.allowed" : "rate_limit.rejected",
      policyId: input.policyId,
      subjectKind: subjects[0]!.kind,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
      remaining,
    });

    return {
      allowed,
      limit: policy.limit,
      remaining,
      resetSeconds,
      policyId: input.policyId,
    };
  }

  /** Runs the check and throws `RateLimitError` (HTTP 429) when rejected. */
  async enforce(input: RateLimitCheckInput): Promise<RateLimitDecision> {
    const decision = await this.check(input);

    if (!decision.allowed) {
      throw new RateLimitError({
        code: errorCodeForPolicy(input.policyId),
        message: "Too many requests. Try again in a moment.",
        retryAfterSeconds: decision.resetSeconds,
        limit: decision.limit,
        remaining: decision.remaining,
        details: {
          limit: decision.limit,
          remaining: decision.remaining,
          resetSeconds: decision.resetSeconds,
          retryAfterSeconds: decision.resetSeconds,
        },
      });
    }

    return decision;
  }
}

/** Default instance, backed by Postgres. What every controller/service imports. */
export const rateLimitService = new RateLimitService(new PostgresRateLimitStore());
