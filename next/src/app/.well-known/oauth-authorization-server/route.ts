/**
 * RFC 8414 authorization server metadata.
 *
 * An MCP client (ChatGPT included) fetches this before ever showing the
 * user a consent screen, to learn where to send the user to authorize and
 * where to exchange a code for a token. `oAuthDiscoveryMetadata` is Better
 * Auth's own implementation, backed by the same `mcp` plugin configuration
 * registered in `src/lib/auth.ts` — this route exists only because Next's
 * App Router needs a real file at this exact path; it contains no logic of
 * its own.
 */

import { oAuthDiscoveryMetadata } from "better-auth/plugins";

import { auth } from "@/lib/auth";

export const GET = oAuthDiscoveryMetadata(auth);
