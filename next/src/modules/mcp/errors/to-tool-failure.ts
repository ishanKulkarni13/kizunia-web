import { ZodError } from "zod";

import { isAppError, RateLimitError } from "@/lib/errors";
import { ErrorCategory } from "@/lib/errors/error-category";

import { McpScopeError } from "./mcp-error";

/**
 * Translates any error raised beneath a tool into the text an MCP client
 * (and, through it, the model) is shown.
 *
 * =============================================================================
 * Why a tool failure and not a JSON-RPC error
 * =============================================================================
 *
 * The MCP specification distinguishes "the request could not be processed"
 * (a JSON-RPC error) from "the tool ran and refused" (a normal result with
 * `isError: true`). A permission denial, a validation failure or a missing
 * competition all belong to the second category: the model can read them and
 * do something sensible — fix the payload, pick a different competition, or
 * tell the user they lack access. Returning those as protocol errors would
 * hide them from the model entirely.
 *
 * =============================================================================
 * What is allowed to cross this boundary
 * =============================================================================
 *
 * Only messages the domain deliberately wrote for a caller. Kizunia's
 * `AppError` subclasses carry exactly that: a stable machine code and a
 * human-readable message already intended for API consumers, which is why
 * they are forwarded as-is.
 *
 * Anything else — a Prisma error, a TypeError, a failed fetch — is collapsed
 * to one opaque sentence. Those messages routinely contain table names,
 * column names, connection strings and query fragments; forwarding them to
 * an external agent that will faithfully repeat them to a user is an
 * information-disclosure bug, so the real error is logged server-side (see
 * `McpTelemetry`) and never returned.
 */
export interface McpToolFailure {
  /** Stable machine-readable code, safe to show. */
  readonly code: string;

  /** Human-readable message, safe to show. */
  readonly message: string;

  /**
   * Field-level validation detail, when the failure was a schema rejection.
   * Present only for validation failures, where knowing *which* field was
   * wrong is what lets the model retry successfully.
   */
  readonly details?: unknown;

  /**
   * Seconds until the caller may retry, present only for a rate-limit
   * rejection. The MCP transport has no header channel (Streamable HTTP
   * here always answers 200 with a JSON-RPC body) — this field is the
   * equivalent of the `Retry-After` header a REST caller would get,
   * carried where an MCP client (and the model behind it) can actually
   * read it.
   */
  readonly retryAfterSeconds?: number;
}

/**
 * True when the error carries a message that was written to be read by an
 * API caller, and can therefore be forwarded unchanged.
 */
function isCallerFacing(error: unknown): boolean {
  if (error instanceof ZodError) {
    return true;
  }

  if (error instanceof McpScopeError) {
    return true;
  }

  if (!isAppError(error)) {
    return false;
  }

  // An internal AppError is caller-facing in *type* but not in *content* —
  // it is the wrapper the domain uses for "something went wrong on our
  // side", and its message and `details` are written for an engineer
  // reading logs, not for an external agent. Everything else (validation,
  // authorization, resource, conflict, rate-limit) is deliberately phrased
  // for the caller.
  return error.category !== ErrorCategory.INTERNAL;
}

export function toMcpToolFailure(error: unknown): McpToolFailure {
  if (error instanceof ZodError) {
    return {
      code: "VALIDATION_FAILED",
      message: "The input did not match the expected schema.",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  if (error instanceof McpScopeError) {
    return {
      code: "MCP_SCOPE_REQUIRED",
      message: error.message,
    };
  }

  if (isAppError(error) && isCallerFacing(error)) {
    return {
      code: error.code,
      message: error.message,
      // `details` is forwarded only for validation failures. On other
      // categories it is a free-form debugging payload with no contract
      // about what it contains, and this boundary does not forward payloads
      // it cannot vouch for.
      details:
        error.category === ErrorCategory.VALIDATION ? error.details : undefined,
      retryAfterSeconds:
        error instanceof RateLimitError ? error.retryAfterSeconds : undefined,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred while handling this request.",
  };
}
