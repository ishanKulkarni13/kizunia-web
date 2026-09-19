import type { StrictAuthorizationActor } from "@/authorization";

import type { McpPrincipal } from "../../auth/authentication";

/**
 * Everything one MCP tool invocation needs to know about its caller,
 * assembled once per request by `buildMcpRequestContext`.
 *
 * Two identities, kept separate on purpose:
 *
 *  - `principal` is the *credential*: which client, which token, which
 *    capabilities were consented to. An MCP concept.
 *
 *  - `actor` is the *Kizunia user*, read fresh from the database. An
 *    ordinary `StrictAuthorizationActor`, identical to what a session-based
 *    request produces, carrying no trace of MCP.
 *
 * Keeping them apart is what lets the application layer take `actor` alone
 * and stay completely MCP-unaware — and what makes it obvious at every call
 * site which of the two a decision is being made from. Authority decisions
 * read `actor`; capability decisions read `principal`.
 */
export interface McpRequestContext {
  readonly principal: McpPrincipal;
  readonly actor: StrictAuthorizationActor;

  /**
   * Correlates every log line emitted while handling this request. Not
   * derived from anything secret — see `McpTelemetry`.
   */
  readonly requestId: string;
}
