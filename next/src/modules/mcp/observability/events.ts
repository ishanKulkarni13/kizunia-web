/**
 * MCP Observability — a domain-typed event seam over the shared logger.
 *
 * `McpEvent`'s specific shape (a closed `McpEventName` union, the
 * `McpFailureOutcome` classification) is precise domain modeling worth
 * keeping. The `console`/sink-swap plumbing it used to hand-roll now lives
 * in `lib/logger`; `setMcpEventSink`/`resetMcpEventSink` are preserved as-is
 * so existing callers and tests keep working, and now sit in front of
 * `lib/logger` instead of `console` directly.
 *
 * =============================================================================
 * What is never emitted
 * =============================================================================
 *
 * No access tokens, no refresh tokens, no token prefixes or fragments. No
 * request or response payloads — a competition import carries free text an
 * external agent scraped from the web, which has no business in an
 * application log. `lib/logger`'s key-based redaction is a second layer here,
 * not the primary control — this module's own field shape is the first and
 * most important one, since `McpEvent` has no field a payload could ever be
 * assigned to in the first place.
 *
 * `userId` and `clientId` *are* emitted, unlike the rate-limit seam's
 * deliberate omission of subject ids. The reason they differ: MCP is a
 * privileged write interface, and "who created this competition, through
 * which connector" is an audit question that has to be answerable after the
 * fact. Both are opaque internal identifiers rather than personal data, and
 * the same pair is already persisted on the row itself via
 * `Competition.createdById`.
 */

import { logger } from "@/lib/logger";

export type McpEventName =
  /** A tool ran to completion and returned a result. */
  | "mcp.tool.succeeded"
  /** A tool refused or failed — see `outcome` for which. */
  | "mcp.tool.failed"
  /** A bearer token was rejected before any tool ran. */
  | "mcp.auth.rejected";

/**
 * Why a call did not succeed. Coarse on purpose: fine-grained reasons
 * belong in the returned error, which the caller already sees. This
 * classification exists so an operator can tell an attack (many
 * `unauthorized` / `forbidden`) apart from a broken client (many
 * `invalid_input`) at a glance.
 */
export type McpFailureOutcome =
  /** The token was missing, expired, or not valid for this resource. */
  | "unauthorized"
  /** The token lacked a required scope. */
  | "scope_denied"
  /** Kizunia's authorization layer denied the actor. */
  | "forbidden"
  /** The input failed schema validation. */
  | "invalid_input"
  /** The target did not exist, or was not visible to this actor. */
  | "not_found"
  /** A domain rule rejected the request (duplicate slug, conflict, …). */
  | "rejected"
  /** The caller exceeded a rate-limit policy's budget. */
  | "rate_limited"
  /** Anything unexpected. The underlying error is logged alongside. */
  | "internal";

export interface McpEvent {
  readonly name: McpEventName;

  /** Correlates every event from one request. */
  readonly requestId: string;

  /** The tool invoked, when the failure happened after dispatch. */
  readonly tool?: string;

  /** The OAuth client the token was issued to. */
  readonly clientId?: string;

  /** The Kizunia user the token resolved to. */
  readonly userId?: string;

  readonly outcome?: McpFailureOutcome;

  /**
   * The stable error code returned to the caller. Safe by construction —
   * it is the same code `toMcpToolFailure` already decided was safe to
   * show.
   */
  readonly code?: string;

  readonly durationMs?: number;

  readonly timestamp: string;
}

export type McpEventSink = (event: McpEvent) => void;

/** Routes through the shared logger rather than touching `console` directly. */
const defaultSink: McpEventSink = (event) => {
  const { name, ...fields } = event;
  logger.info(name, fields);
};

let sink: McpEventSink = defaultSink;

/** Swaps the event sink — for tests, and later for a real logger pipeline. */
export function setMcpEventSink(next: McpEventSink): void {
  sink = next;
}

/** Restores the default sink (routed through `lib/logger`). Mainly for tests to clean up. */
export function resetMcpEventSink(): void {
  sink = defaultSink;
}

export function emitMcpEvent(event: Omit<McpEvent, "timestamp">): void {
  sink({ ...event, timestamp: new Date().toISOString() });
}

/**
 * Records the *real* error for an operator, separately from the sanitised
 * one the caller receives.
 *
 * This is the counterpart to `toMcpToolFailure` collapsing unknown errors
 * to an opaque message: the detail still has to exist somewhere, just not
 * in the response. Routed through `logger.error` rather than the event sink
 * because an arbitrary `unknown` cannot be serialised into the typed,
 * payload-free `McpEvent` shape above without defeating its purpose —
 * `logger.error` normalizes it instead (stack, `AppError` fields, cause
 * chain) rather than requiring a caller to pre-shape it.
 */
export function reportMcpInternalError(
  requestId: string,
  tool: string | undefined,
  error: unknown,
): void {
  logger.error("mcp.internal_error", error, { requestId, tool });
}
