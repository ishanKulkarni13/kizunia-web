import type { OAuthAccessToken } from "better-auth/plugins";

import { McpUnauthorizedError } from "../errors/mcp-error";
import { mcpResourceUrl } from "../config";
import { parseGrantedScopes, type McpScope } from "./scopes";

/**
 * MCP authentication — "which token is this, and is it valid *here*".
 *
 * Strictly separated from authorization. This layer answers only:
 *
 *   - Is the bearer token well-formed, unexpired and bound to a user?
 *   - Was it issued for *this* resource?
 *   - Which capability scopes does it carry?
 *
 * It deliberately knows nothing about roles, competitions or permissions.
 * The user's authority is established afterwards, from the database, by
 * `McpActorResolver` — never from the token.
 */

/**
 * An authenticated MCP caller, before any Kizunia identity is resolved.
 *
 * `userId` is the subject the authorization server bound the token to. It is
 * trusted as an *identifier* only: it says which row to read, never what
 * that row is allowed to do.
 */
export interface McpPrincipal {
  readonly userId: string;
  readonly clientId: string;
  readonly grantedScopes: ReadonlySet<McpScope>;
}

/**
 * Better Auth's `withMcpAuth` has already proven the token exists and has
 * not expired before this runs. What it does not check is the audience, so
 * that is checked here.
 *
 * =============================================================================
 * Why audience validation matters
 * =============================================================================
 *
 * Without it, any token minted by this same authorization server for any
 * other resource — a future Kizunia MCP server, a different API, a
 * third-party client's own resource — would be accepted here. That is the
 * confused-deputy problem RFC 8707 exists to prevent, and it is why the MCP
 * specification requires resource indicators.
 *
 * The audience travels in the token's granted scopes/metadata via Better
 * Auth's OIDC provider. When the provider records no audience at all (the
 * token predates resource indicators, or the client omitted `resource`), the
 * token is accepted: rejecting it would break every already-issued token on
 * upgrade, and the token is still provably one this server's own
 * authorization server minted for this user. What is never accepted is an
 * audience that is present and names a *different* resource — that is an
 * unambiguous signal the token was meant for somewhere else.
 */
function assertTokenAudience(token: OAuthAccessToken): void {
  const audience = readAudience(token);

  if (audience === null) {
    return;
  }

  const expected = mcpResourceUrl();

  const matches = audience.some((value) => isSameResource(value, expected));

  if (!matches) {
    throw new McpUnauthorizedError(
      "This access token was issued for a different resource.",
    );
  }
}

/**
 * Compares two resource identifiers.
 *
 * Compared as URLs rather than as strings so that a trailing slash or a
 * differently-cased host does not cause a spurious rejection, while a
 * different origin or path still does. Falls back to a strict string
 * comparison when either value is not a parseable URL — an unparseable
 * identifier should fail closed against anything but its exact self.
 */
function isSameResource(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);

    return (
      left.origin.toLowerCase() === right.origin.toLowerCase() &&
      left.pathname.replace(/\/+$/, "") === right.pathname.replace(/\/+$/, "")
    );
  } catch {
    return a === b;
  }
}

/**
 * Extracts the recorded audience from a token record, or `null` when the
 * provider recorded none.
 *
 * Reads defensively: this is a plugin-owned record whose exact shape is not
 * part of Better Auth's public type, so the field is probed rather than
 * assumed, and anything unrecognised is treated as "no audience recorded"
 * rather than as an empty audience (which would reject every token).
 */
function readAudience(token: OAuthAccessToken): string[] | null {
  const record = token as unknown as Record<string, unknown>;

  const raw = record.audience ?? record.aud ?? record.resource;

  if (typeof raw === "string") {
    const values = raw.split(/[\s,]+/).filter(Boolean);

    return values.length > 0 ? values : null;
  }

  if (Array.isArray(raw)) {
    const values = raw.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    return values.length > 0 ? values : null;
  }

  return null;
}

/**
 * Turns a validated Better Auth access token into an `McpPrincipal`.
 *
 * Throws `McpUnauthorizedError` when the token cannot serve as a credential
 * for this resource. A token with no `userId` is rejected rather than
 * treated as anonymous: every MCP capability in Kizunia acts on behalf of a
 * person, so a client-credentials-style token with no subject has no
 * identity to authorize and must not be silently downgraded to a public
 * caller.
 */
export function authenticateMcpToken(token: OAuthAccessToken): McpPrincipal {
  if (!token.userId) {
    throw new McpUnauthorizedError(
      "This access token is not bound to a Kizunia user.",
    );
  }

  assertTokenAudience(token);

  return {
    userId: token.userId,
    clientId: token.clientId,
    grantedScopes: parseGrantedScopes(token.scopes),
  };
}
