import type { OAuthAccessToken } from "better-auth/plugins";

import { authenticateMcpToken } from "../../auth/authentication";
import { McpActorResolver } from "../../auth/actor-resolver";
import type { McpRequestContext } from "./request-context";

/**
 * Assembles the complete `McpRequestContext` for one MCP call.
 *
 * The single seam between "a Better Auth token was validated" and "a tool
 * has everything it needs" — it runs authentication (`authenticateMcpToken`)
 * then actor resolution (`McpActorResolver`), in that order, and nothing
 * downstream repeats either step. A tool is handed the finished context; it
 * never sees the raw token.
 */
export async function buildMcpRequestContext(
  token: OAuthAccessToken,
  requestId: string,
): Promise<McpRequestContext> {
  const principal = authenticateMcpToken(token);
  const actor = await McpActorResolver.resolve(principal);

  return { principal, actor, requestId };
}
