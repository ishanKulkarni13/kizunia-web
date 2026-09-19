import { McpScopeError } from "../errors/mcp-error";
import type { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";

/**
 * The MCP capability boundary — and *only* that.
 *
 * =============================================================================
 * This is not a second authorization system
 * =============================================================================
 *
 * There is exactly one function here, and it answers one question:
 *
 *     "Was this MCP client granted permission to attempt this capability?"
 *
 * It does not know about roles, competitions, membership, visibility or
 * ownership, and it must never learn about them. Those questions are already
 * answered by `PlatformPolicy` and `CompetitionPolicy`, and the application
 * layer calls those directly through the existing `PlatformAuthorizer` /
 * `CompetitionAuthorizer` — the same call sites the REST controllers use.
 *
 * Deliberately absent, and to stay absent: helpers such as
 * `mcpCanCreateCompetition()`. A function like that would be a second,
 * drifting copy of `CompetitionAuthorizer.create`, and the two would
 * eventually disagree — which is precisely the failure mode that turns an
 * authorization system into a vulnerability.
 *
 * =============================================================================
 * Ordering
 * =============================================================================
 *
 * The scope check runs first because it is free (no database read) and
 * because a capability the user never consented to expose should be refused
 * before the request reaches the domain at all. The Kizunia authorization
 * decision then runs inside the use case, against a freshly-read actor, and
 * is always authoritative: a granted scope can never make a denied action
 * allowed.
 */

/**
 * Asserts the access token carries `scope`.
 *
 * @throws {McpScopeError} when the token was not granted it.
 */
export function requireScope(
  context: McpRequestContext,
  scope: McpScope,
): void {
  if (!context.principal.grantedScopes.has(scope)) {
    throw new McpScopeError(scope);
  }
}
