/**
 * Better Auth catch-all, wrapped with rate limiting on the specific
 * operations that actually need it.
 *
 * Better Auth ships its own rate limiter (see its `rateLimit` option),
 * enabled by default in production at a flat 100 requests / 10 seconds per
 * IP, in-memory unless a `secondaryStorage` is configured. Kizunia's
 * `lib/auth.ts` does not override it, so that default is already active in
 * production today. It is not a substitute for what this wraps in:
 *
 *  - In-memory storage means it does not hold across serverless instances
 *    — the exact multi-instance problem this codebase's own limiter exists
 *    to avoid elsewhere (see lib/rate-limit).
 *  - One flat budget across every auth operation is not a credential-
 *    stuffing defense; 100 requests/10s is far too generous for repeated
 *    sign-in attempts against one account.
 *
 * So specific, higher-risk operations get a second, stricter, Postgres-
 * backed layer on top — not a replacement. Everything else Better Auth
 * exposes (session reads, OAuth callbacks, sign-out, etc.) passes straight
 * through unlimited by this layer, deliberately: this is not a blanket
 * limiter over the whole catch-all, which would risk breaking flows (OAuth
 * redirects in particular) this pass has no need to touch.
 */

import { NextRequest, NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import { createErrorResponse, RateLimitError } from "@/lib/errors";
import { rateLimitErrorHeaders } from "@/lib/rate-limit/headers";
import { RATE_LIMIT_POLICIES, RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

const { GET: authGet, POST: authPost } = toNextJsHandler(auth);

/**
 * Maps a specific method + path to the policy that protects it. Everything
 * not listed here is intentionally unprotected by this layer — see the
 * module docstring.
 */
function resolveAuthPolicy(
  method: string,
  pathname: string,
): RateLimitPolicyId | null {
  if (method !== "POST") {
    return null;
  }

  if (
    pathname.endsWith("/sign-in/email") ||
    pathname.endsWith("/sign-in/username")
  ) {
    return RateLimitPolicyId.AUTH_SIGN_IN;
  }

  if (pathname.endsWith("/sign-up/email")) {
    return RateLimitPolicyId.AUTH_SIGN_UP;
  }

  if (pathname.endsWith("/request-password-reset")) {
    return RateLimitPolicyId.AUTH_PASSWORD_RESET_REQUEST;
  }

  return null;
}

/**
 * Best-effort extraction of the submitted email/username, to key the
 * "credential" dimension on. Reads a clone of the body so the original
 * request stream is left untouched for Better Auth's own handler.
 *
 * Returning `null` on anything unexpected (not JSON, no recognizable
 * field) is deliberate: a malformed body is Better Auth's own validation
 * error to raise, not a reason for this wrapper to fail differently than
 * it would if rate limiting did not exist here at all.
 */
async function extractCredential(request: NextRequest): Promise<string | null> {
  try {
    const body: unknown = await request.clone().json();

    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;

      if (typeof record.email === "string") return record.email;
      if (typeof record.username === "string") return record.username;
    }
  } catch {
    // Not JSON, or no body — fall through to null.
  }

  return null;
}

export async function GET(request: NextRequest) {
  return authGet(request);
}

export async function POST(request: NextRequest) {
  const policyId = resolveAuthPolicy(request.method, request.nextUrl.pathname);

  if (policyId) {
    const credential = await extractCredential(request);

    const requiresCredential =
      RATE_LIMIT_POLICIES[policyId].subjectStrategies.includes("credential");

    // A missing credential on a policy that requires one (a malformed or
    // non-JSON body) makes `enforce` throw a plain `Error`, not a
    // `RateLimitError` — see `resolveSubjectsForStrategies`. That case is
    // deliberately skipped rather than enforced: a malformed body is
    // Better Auth's own validation error to raise next, not a reason for
    // this wrapper to block the request differently than it would if rate
    // limiting did not exist on this route at all.
    const shouldEnforce = !requiresCredential || credential !== null;

    if (shouldEnforce) {
      try {
        await rateLimitService.enforce({
          policyId,
          request,
          credential: credential ?? undefined,
        });
      } catch (error) {
        if (error instanceof RateLimitError) {
          return NextResponse.json(createErrorResponse(error), {
            status: error.status,
            headers: rateLimitErrorHeaders(error),
          });
        }

        throw error;
      }
    }
  }

  return authPost(request);
}
