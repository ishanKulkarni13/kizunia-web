/**
 * Rate Limit Subject — the identity dimension a limit is keyed on.
 *
 * A typed union in place of a bare `identifier: string` so that adding a new
 * kind of caller (an API key, a service account, an organization) is a
 * compile-time exhaustiveness change at every call site, not a silent
 * string-format change. See docs/architecture — this is the seam the future
 * API key / organization work attaches to without touching a controller.
 *
 * `api_key`, `service_account`, and `organization` are reserved here and
 * constructed nowhere yet. Nothing in this codebase issues API keys or has
 * an organization model (see the audit); listing the variants now means the
 * day one of them exists, every `switch` over `SubjectKind` that isn't
 * updated fails to compile instead of silently mis-handling the new kind.
 */

import type { RateLimitSubjectStrategy } from "./policies";

export type RateLimitSubjectKind =
  | "user"
  | "ip"
  | "global"
  /**
   * A caller-submitted, pre-authentication identifier (an email or username
   * on a sign-in or password-reset-request attempt). Distinct from `user`
   * because no session exists yet to authenticate it — the value is exactly
   * what the caller typed, real account or not, which is what makes rate
   * limiting on it safe: an unknown identifier is throttled identically to
   * a known one, so the limiter itself leaks nothing about whether the
   * account exists.
   */
  | "credential"
  /** Reserved. No API key model exists yet. */
  | "api_key"
  /** Reserved. No service-account concept exists yet. */
  | "service_account"
  /** Reserved. No organization/tenant model exists yet — see the audit. */
  | "organization";

export interface RateLimitSubject {
  readonly kind: RateLimitSubjectKind;
  readonly id: string;
}

export function userSubject(userId: string): RateLimitSubject {
  return { kind: "user", id: userId };
}

export function ipSubject(ip: string): RateLimitSubject {
  return { kind: "ip", id: ip };
}

/**
 * The subject for a platform-wide budget rather than a per-caller limit —
 * e.g. the Google Places resolution spend cap. There is exactly one bucket
 * per policy using this subject, by construction: every caller shares it.
 */
export function globalSubject(): RateLimitSubject {
  return { kind: "global", id: "global" };
}

/**
 * A caller-submitted identifier, used only for the narrow set of
 * pre-authentication endpoints where limiting per-identifier is a known,
 * safe defense (credential stuffing targeting one account; password-reset
 * spam against one address). The value is used exactly as submitted —
 * never looked up against the database — so this subject carries no
 * information about whether the identifier corresponds to a real account.
 */
export function credentialSubject(rawValue: string): RateLimitSubject {
  return { kind: "credential", id: rawValue.trim().toLowerCase() };
}

/**
 * Encodes a subject id so it can never collide across subjects or scopes
 * once joined into a store key with `:` separators.
 *
 * Two concrete collisions this closes:
 *  - An IPv6 address containing `:` (e.g. `2001:db8::1`) could otherwise
 *    straddle the `scope:kind:id:window` boundaries and alias against an
 *    unrelated key.
 *  - Any future identifier source (an API key id, say) that happens to
 *    contain `:` would have the same problem.
 *
 * `encodeURIComponent` leaves `:` (and a handful of other reserved
 * characters) untouched, so it is not enough on its own — hence the
 * explicit replace.
 */
export function encodeSubjectSegment(value: string): string {
  return encodeURIComponent(value).replace(/:/g, "%3A");
}

/**
 * Best-effort trusted client IP for an anonymous caller, on Vercel's edge
 * network.
 *
 * Precedence, and why:
 *
 *  1. `x-real-ip` — Vercel sets this to the real connecting client IP on
 *     every request, overwriting whatever the client supplied. It is a
 *     single value with nothing to disambiguate, which is what makes it
 *     trustworthy.
 *  2. The LAST entry of `x-forwarded-for` — Vercel's edge appends the true
 *     client IP to this header as it passes the request through. A client
 *     can prepend arbitrary entries to the front of `x-forwarded-for`
 *     before the request ever reaches Vercel, but cannot control what gets
 *     appended after — so the leftmost entry (what the previous
 *     implementation used) is fully attacker-controlled, while the
 *     rightmost is not. Taking the first entry, as the prior implementation
 *     did, let a single spoofed header mint unlimited distinct buckets.
 *  3. `"unknown"` — no proxy in front of the app (local dev, a direct-to-
 *     node deployment). Every such caller shares one bucket for a limited
 *     policy; that is a known, accepted degradation for those environments,
 *     not a security promise.
 *
 * This function makes no claim beyond "the best identity available in this
 * deployment" — it bounds accidental and casual abuse, not a determined
 * attacker with access to arbitrary source IPs.
 */
export function resolveTrustedClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();

  if (realIp) {
    return realIp;
  }

  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim());

    const clientAppendedHop = hops[hops.length - 1];

    if (clientAppendedHop) {
      return clientAppendedHop;
    }
  }

  return "unknown";
}

/**
 * The subject for an HTTP request: the authenticated user when there is
 * one, otherwise the best trusted client IP.
 *
 * Preferring the user id over IP once authenticated is deliberate — it
 * gives an accurate per-caller bucket regardless of shared NAT or corporate
 * egress, and it is the dimension that survives into the API-key future
 * (an API key resolves to an owner the same way a session resolves to a
 * user).
 */
export function subjectFromRequest(
  request: Request,
  actor?: { id: string | null | undefined } | null,
): RateLimitSubject {
  if (actor?.id) {
    return userSubject(actor.id);
  }

  return ipSubject(resolveTrustedClientIp(request));
}

/**
 * Resolves one concrete {@link RateLimitSubject} per configured strategy on
 * a policy. A policy listing more than one strategy (e.g. sign-in: `["ip",
 * "credential"]`) is checked on every listed dimension — the caller must
 * pass every one of them, not just one.
 *
 * "request" is optional because "global" and "user" (and "credential", given
 * a credential) need no request at all — see, e.g., the global Places
 * resolution budget in `place-match.service.ts`, which is deliberately
 * enforced from a domain service with no request in scope. "user",
 * "credential", "ip", and "user-or-ip" each have a real precondition
 * (an authenticated actor, a submitted credential, or a request,
 * respectively) and throw here rather than silently degrading — falling
 * back to a weaker dimension on a misconfigured policy would quietly
 * weaken exactly the protection the policy exists to provide.
 */
export function resolveSubjectsForStrategies(
  strategies: readonly RateLimitSubjectStrategy[],
  context: {
    readonly request?: Request;
    readonly actor?: { id: string | null | undefined } | null;
    readonly credential?: string | null;
  },
): RateLimitSubject[] {
  return strategies.map((strategy) => {
    switch (strategy) {
      case "ip": {
        if (!context.request) {
          throw new Error(
            'Rate limit policy uses the "ip" subject strategy but no request was provided.',
          );
        }

        return ipSubject(resolveTrustedClientIp(context.request));
      }

      case "user": {
        if (!context.actor?.id) {
          throw new Error(
            'Rate limit policy uses the "user" subject strategy but no authenticated actor was provided.',
          );
        }

        return userSubject(context.actor.id);
      }

      case "user-or-ip": {
        if (!context.request) {
          throw new Error(
            'Rate limit policy uses the "user-or-ip" subject strategy but no request was provided.',
          );
        }

        return subjectFromRequest(context.request, context.actor);
      }

      case "global":
        return globalSubject();

      case "credential": {
        if (!context.credential) {
          throw new Error(
            'Rate limit policy uses the "credential" subject strategy but no credential was provided.',
          );
        }

        return credentialSubject(context.credential);
      }
    }
  });
}
