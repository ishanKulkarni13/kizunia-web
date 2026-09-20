/**
 * RFC 9728 protected-resource metadata for the MCP endpoint.
 *
 * This is what an MCP client reads out of a 401's `WWW-Authenticate` header
 * (see `withMcpAuth`) to discover which authorization server issues tokens
 * for `/api/mcp` and which scopes it can ask for. `oAuthProtectedResourceMetadata`
 * is Better Auth's implementation; this file only satisfies Next's routing
 * requirement that a real file exist at this well-known path.
 */

import { oAuthProtectedResourceMetadata } from "better-auth/plugins";

import { auth } from "@/lib/auth";

export const GET = oAuthProtectedResourceMetadata(auth);
