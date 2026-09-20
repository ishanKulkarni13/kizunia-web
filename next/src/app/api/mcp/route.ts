/**
 * MCP JSON-RPC endpoint — `POST /api/mcp`.
 *
 * This file is intentionally small: it is the transport boundary and
 * nothing else. `withMcpAuth` (Better Auth's MCP plugin) validates the
 * bearer token — existence, expiry, binding to a user — before this handler
 * ever runs; everything Kizunia-specific (audience check, actor resolution,
 * scope check, tool execution, error mapping) lives in
 * `src/modules/mcp/server/transport/dispatch.ts`, which is unit-testable
 * without an HTTP request at all.
 *
 * GET is not implemented: this is the "Streamable HTTP" MCP transport in
 * its simplest form — one JSON-RPC request per POST, no server-initiated
 * SSE stream. That is sufficient for request/response tools like the ones
 * this server exposes today; adding streaming later is additive here, not
 * a breaking change to this route's shape.
 */

import { withMcpAuth } from "better-auth/plugins";

import { auth } from "@/lib/auth";

import { dispatchMcpRequest } from "@/modules/mcp/server/transport/dispatch";

export const POST = withMcpAuth(auth, async (req, token) => {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Request body is not valid JSON." },
      },
      { status: 200 },
    );
  }

  const response = await dispatchMcpRequest(body, token);

  return Response.json(response);
});
