/**
 * MCP Observability — a structured-event seam, not a logger.
 *
 * Deliberately modelled on `src/lib/rate-limit/events.ts`, the existing
 * convention in this repository: a single typed emission point that a real
 * logger can be swapped in behind, rather than a second logging framework.
 * Nothing else in the MCP module should call `console.*` directly.
 *
 * =============================================================================
 * What is never emitted
 * =============================================================================
 *
 * No access tokens, no refresh tokens, no token prefixes or fragments. No
 * request or response payloads — a competition import carries free text an
 * external agent scraped from the web, which has no business in an
 * application log.
 *
 * `userId` and `clientId` *are* emitted, unlike the rate-limit seam's
 * deliberate omission of subject ids. The reason they differ: MCP is a
 * privileged write interface, and "who created this competition, through
 * which connector" is an audit question that has to be answerable after the
 * fact. Both are opaque internal identifiers rather than personal data, and
 * the same pair is already persisted on the row itself via
 * `Competition.createdById`.
 */

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

/**
 * The one place in this module that touches `console`. Structured JSON so
 * it is queryable in Vercel's log capture before a real aggregator exists.
 */
const defaultSink: McpEventSink = (event) => {
  console.info(JSON.stringify(event));
};

let sink: McpEventSink = defaultSink;

/** Swaps the event sink — for tests, and later for a real logger pipeline. */
export function setMcpEventSink(next: McpEventSink): void {
  sink = next;
}

/** Restores the default console sink. Mainly for tests to clean up. */
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
 * in the response. Routed through `console.error` rather than the event
 * sink because an arbitrary `unknown` cannot be serialised into the typed,
 * payload-free `McpEvent` shape above without defeating its purpose.
 */
export function reportMcpInternalError(
  requestId: string,
  tool: string | undefined,
  error: unknown,
): void {
  console.error("MCP internal error", { requestId, tool }, error);
}
