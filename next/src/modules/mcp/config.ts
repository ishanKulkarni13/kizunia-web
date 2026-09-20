/**
 * MCP configuration — the single place MCP reads the environment.
 *
 * Everything environment-dependent about the MCP surface is resolved here so
 * that no other MCP file contains `process.env`. That keeps the deployment
 * contract in one readable place (mirrored in `.env.example` and
 * `docs/architecture/mcp/README.md`) and makes the values trivially
 * substitutable in tests.
 *
 * Read lazily, inside functions, rather than captured into module constants
 * at import time: this module is imported by `src/lib/auth.ts`, which is
 * itself imported from both server components and route handlers, and a
 * value frozen at import time would be wrong in any runtime that loads the
 * module before the environment is populated.
 */

/**
 * The public origin this deployment is reachable at, without a trailing
 * slash.
 *
 * Deliberately the same variable Better Auth is configured with, so the
 * OAuth issuer and the MCP resource identifier can never disagree — a
 * mismatch between them is exactly the condition that makes audience
 * validation either vacuous or permanently failing.
 */
export function mcpBaseUrl(): string {
  const base =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  return base.replace(/\/+$/, "");
}

/**
 * The path the MCP JSON-RPC endpoint is mounted at.
 *
 * A constant rather than an environment variable: it is part of the
 * application's route structure (`src/app/api/mcp/route.ts`), not a
 * deployment choice, and an MCP client discovers it from the URL the user
 * pastes in rather than from configuration.
 */
export const MCP_ENDPOINT_PATH = "/api/mcp";

/**
 * This MCP server's RFC 8707 resource identifier: the canonical absolute URL
 * of the MCP endpoint.
 *
 * Advertised in protected-resource metadata, sent by clients as the
 * `resource` parameter, and compared against an incoming token's audience.
 * Always absolute — a relative identifier cannot be compared against a
 * token audience at all.
 */
export function mcpResourceUrl(): string {
  return `${mcpBaseUrl()}${MCP_ENDPOINT_PATH}`;
}

/**
 * Where an unauthenticated OAuth authorization request is sent so the human
 * can sign in. A real Kizunia sign-in page, because the point of the flow is
 * that the *user* — never the MCP client — proves who they are.
 */
export const MCP_LOGIN_PAGE = "/sign-in";

/**
 * The MCP protocol version this server implements, returned in the
 * `initialize` response.
 *
 * Pinned rather than echoed back from the client's request: claiming to
 * speak whatever version the caller asked for is how a server ends up
 * silently mis-implementing a protocol it does not actually support.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * How this server identifies itself during `initialize`.
 */
export const MCP_SERVER_INFO = {
  name: "kizunia",
  title: "Kizunia",
  version: "1.0.0",
} as const;
