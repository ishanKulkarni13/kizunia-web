/**
 * MCP OAuth scopes — the capability boundary of an *access token*.
 *
 * =============================================================================
 * What a scope is, and what it is not
 * =============================================================================
 *
 * A scope answers exactly one question:
 *
 *     "May this MCP client ask for this capability on the user's behalf?"
 *
 * It never answers:
 *
 *     "May this user perform this action?"
 *
 * That second question belongs to Kizunia's authorization layer
 * (`PlatformPolicy` / `CompetitionPolicy`) and is answered there, on every
 * call, against a freshly-read user row — see `resolveMcpActor`.
 *
 * Scopes can therefore only ever *narrow*. A token carrying
 * `competitions:write` held by an ordinary USER still cannot create a
 * competition, because `PlatformAction.CREATE_COMPETITION` is not in that
 * role's permission set. Granting a scope is not a grant of authority; it is
 * the user telling Kizunia which subset of their *existing* authority a
 * particular client may exercise.
 *
 * Both checks are enforced, scope first (cheap, no database read) then
 * Kizunia authorization (authoritative). Scope-first ordering is deliberate:
 * a token that was never granted a capability should be refused without the
 * request ever reaching the domain.
 *
 * =============================================================================
 * Why `openid`/`profile`/`email` are not listed here
 * =============================================================================
 *
 * Those are OIDC identity scopes owned by Better Auth's provider, not
 * Kizunia capabilities. They gate who the token says the user is; the scopes
 * below gate what may be done. They are deliberately kept in separate
 * namespaces so a future identity scope can never be mistaken for a
 * capability grant.
 */

/**
 * The Kizunia capability scopes an MCP access token may carry.
 *
 * Namespaced `resource:capability` so a second resource (projects, blogs)
 * can be added later without either colliding with these or being implicitly
 * granted by them.
 */
export const McpScope = {
  /**
   * Read competitions: search the public catalogue and read a single
   * competition. Nothing this scope permits can mutate state.
   */
  COMPETITIONS_READ: "competitions:read",

  /**
   * Create and update competitions.
   *
   * Deliberately one scope rather than two. Splitting create from update
   * would imply a client could be trusted with one and not the other, which
   * is not a distinction Kizunia's authorization layer makes — a role that
   * may create may also edit what it created. A single write scope keeps the
   * consent screen honest about what the user is actually agreeing to.
   *
   * Holding it is still not sufficient: every write additionally requires
   * the platform/competition authorization decision to allow the action.
   */
  COMPETITIONS_WRITE: "competitions:write",
} as const;

export type McpScope = (typeof McpScope)[keyof typeof McpScope];

/**
 * Every Kizunia capability scope, for OAuth discovery metadata
 * (`scopes_supported`) and for validating a client's requested scope string.
 */
export const MCP_SCOPES: readonly McpScope[] = Object.values(McpScope);

/**
 * OIDC identity scopes the provider issues alongside the capability scopes
 * above. Listed so discovery metadata advertises the complete set, and so
 * `isMcpScope` can tell "an identity scope" apart from "an unknown string".
 */
export const MCP_IDENTITY_SCOPES: readonly string[] = [
  "openid",
  "profile",
  "email",
  "offline_access",
];

/**
 * The complete `scopes_supported` advertised at
 * `/.well-known/oauth-authorization-server`.
 */
export const MCP_SUPPORTED_SCOPES: readonly string[] = [
  ...MCP_IDENTITY_SCOPES,
  ...MCP_SCOPES,
];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/**
 * Parses the space-separated `scopes` string stored on an issued access
 * token into the set of Kizunia capability scopes it carries.
 *
 * Unknown entries and identity scopes are discarded rather than rejected: a
 * token legitimately carries `openid profile competitions:read`, and an
 * unrecognised scope must not be able to fail the whole request open *or*
 * closed — it simply grants nothing, which is the deny-by-default reading.
 *
 * Tolerates the comma separator some clients emit in addition to the
 * space separator required by RFC 6749 §3.3, because a mis-separated scope
 * string should degrade to "fewer capabilities", never to "one scope named
 * `a,b`" that silently matches nothing.
 */
export function parseGrantedScopes(scopes: string | null | undefined): Set<McpScope> {
  if (!scopes) {
    return new Set();
  }

  const granted = new Set<McpScope>();

  for (const raw of scopes.split(/[\s,]+/)) {
    const value = raw.trim();

    if (value && isMcpScope(value)) {
      granted.add(value);
    }
  }

  return granted;
}
