import { randomUUID } from "node:crypto";

import { z } from "zod";
import type { OAuthAccessToken } from "better-auth/plugins";

import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
} from "../../config";
import { McpScopeError, McpProtocolError, JsonRpcErrorCode } from "../../errors/mcp-error";
import { toMcpToolFailure } from "../../errors/to-tool-failure";
import {
  emitMcpEvent,
  reportMcpInternalError,
  type McpFailureOutcome,
} from "../../observability/events";
import { isAppError, RateLimitError } from "@/lib/errors";
import { ErrorCategory } from "@/lib/errors/error-category";
import { RATE_LIMIT_POLICIES, rateLimitService } from "@/lib/rate-limit";
import { MCP_TOOLS } from "../../tools/registry";
import type { McpTool } from "../../tools/types";
import { buildMcpRequestContext } from "../context/build-request-context";
import {
  isJsonRpcRequest,
  jsonRpcError,
  jsonRpcResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./json-rpc";

/**
 * MCP method dispatch — the layer that knows the MCP *protocol*
 * (`initialize`, `tools/list`, `tools/call`) without knowing anything about
 * any individual tool's business logic. Everything tool-specific lives in
 * `tools/registry.ts` and beneath it.
 */

/**
 * Handles one already-authenticated JSON-RPC request.
 *
 * `token` has already passed Better Auth's own expiry/existence check (see
 * `withMcpAuth` at the route boundary) — this layer performs the further
 * audience and scope checks that are specific to Kizunia's MCP resource, via
 * `buildMcpRequestContext`.
 */
export async function dispatchMcpRequest(
  body: unknown,
  token: OAuthAccessToken,
): Promise<JsonRpcResponse> {
  if (!isJsonRpcRequest(body)) {
    return jsonRpcError(
      null,
      JsonRpcErrorCode.INVALID_REQUEST,
      "Request is not a valid JSON-RPC 2.0 message.",
    );
  }

  const request: JsonRpcRequest = body;

  try {
    switch (request.method) {
      case "initialize":
        return jsonRpcResult(request.id, handleInitialize());

      case "notifications/initialized":
        // A notification — no response body is meaningful, but this
        // transport is request/response (one HTTP call per JSON-RPC
        // message), so an empty acknowledgement is returned rather than
        // nothing.
        return jsonRpcResult(request.id, {});

      case "tools/list":
        return jsonRpcResult(request.id, handleToolsList());

      case "tools/call":
        return await handleToolsCall(request, token);

      default:
        return jsonRpcError(
          request.id,
          JsonRpcErrorCode.METHOD_NOT_FOUND,
          `Unknown method "${request.method}".`,
        );
    }
  } catch (error) {
    if (error instanceof McpProtocolError) {
      return jsonRpcError(request.id, error.code, error.message);
    }

    reportMcpInternalError(randomUUID(), request.method, error);

    return jsonRpcError(
      request.id,
      JsonRpcErrorCode.INTERNAL_ERROR,
      "An unexpected error occurred.",
    );
  }
}

function handleInitialize() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: MCP_SERVER_INFO,
    capabilities: {
      tools: {},
    },
  };
}

function handleToolsList() {
  return {
    tools: Array.from(MCP_TOOLS.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema, { target: "draft-7" }),
    })),
  };
}

const ToolCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.unknown().optional(),
});

async function handleToolsCall(
  request: JsonRpcRequest,
  token: OAuthAccessToken,
): Promise<JsonRpcResponse> {
  const requestId = randomUUID();

  const paramsResult = ToolCallParamsSchema.safeParse(request.params);

  if (!paramsResult.success) {
    return jsonRpcError(
      request.id,
      JsonRpcErrorCode.INVALID_PARAMS,
      "`params` must be `{ name: string; arguments?: object }`.",
    );
  }

  const { name, arguments: rawArguments } = paramsResult.data;

  const tool = MCP_TOOLS.get(name);

  if (!tool) {
    return jsonRpcError(
      request.id,
      JsonRpcErrorCode.METHOD_NOT_FOUND,
      `Unknown tool "${name}".`,
    );
  }

  const startedAt = Date.now();

  try {
    const context = await buildMcpRequestContext(token, requestId);

    await enforceToolRateLimit(tool, context.actor.id);

    const input = tool.inputSchema.parse(rawArguments ?? {});

    const result = await tool.execute(context, input);

    emitMcpEvent({
      name: "mcp.tool.succeeded",
      requestId,
      tool: name,
      clientId: context.principal.clientId,
      userId: context.actor.id,
      durationMs: Date.now() - startedAt,
    });

    return jsonRpcResult(request.id, toToolResult(result));
  } catch (error) {
    const failure = toMcpToolFailure(error);

    emitMcpEvent({
      name: "mcp.tool.failed",
      requestId,
      tool: name,
      outcome: classifyFailure(error),
      code: failure.code,
      durationMs: Date.now() - startedAt,
    });

    if (!isAppError(error) && !(error instanceof z.ZodError) && !(error instanceof McpScopeError)) {
      reportMcpInternalError(requestId, name, error);
    }

    return jsonRpcResult(request.id, {
      content: [{ type: "text", text: JSON.stringify(failure) }],
      isError: true,
    });
  }
}

/**
 * Enforces the tool's declared rate-limit policy before it runs.
 *
 * `tool.rateLimitPolicy` is a required field on `McpTool` (see
 * `tools/types.ts`) precisely so this cannot be skipped by omission — every
 * tool that can be registered has already made an explicit classification
 * decision at compile time. `RATE_LIMIT_POLICIES[policy]` is looked up
 * rather than trusted as a bare string so that a value which somehow still
 * reaches here unrecognised (a stale build, an unsafe cast, a future
 * non-TypeScript tool source) fails *closed* — rejected as rate-limited —
 * rather than silently bypassing enforcement. A missing policy is an
 * availability risk for one caller; treating it as an open bypass would be
 * a security one, and this system never trades the latter for the former.
 */
async function enforceToolRateLimit(tool: McpTool, userId: string): Promise<void> {
  const policyId = tool.rateLimitPolicy;

  if (!RATE_LIMIT_POLICIES[policyId]) {
    throw new RateLimitError({
      code: "MCP_TOOL_RATE_LIMIT_UNCLASSIFIED",
      message:
        "This tool has no recognised rate-limit policy configured and cannot be called.",
    });
  }

  await rateLimitService.enforce({ policyId, actor: { id: userId } });
}

/**
 * Wraps a use case's return value in the MCP `tools/call` result envelope.
 *
 * MCP tool results are a list of content blocks; a JSON-serialisable
 * domain object is rendered as one `text` block carrying its JSON — the
 * same shape most MCP servers use for structured data before richer
 * per-tool output schemas are worth introducing.
 */
function toToolResult(result: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}

function classifyFailure(error: unknown): McpFailureOutcome {
  if (error instanceof z.ZodError) {
    return "invalid_input";
  }

  if (error instanceof McpScopeError) {
    return "scope_denied";
  }

  if (!isAppError(error)) {
    return "internal";
  }

  switch (error.category) {
    case ErrorCategory.AUTHENTICATION:
      return "unauthorized";
    case ErrorCategory.AUTHORIZATION:
      return "forbidden";
    case ErrorCategory.VALIDATION:
      return "invalid_input";
    case ErrorCategory.RESOURCE:
      return "not_found";
    case ErrorCategory.CONFLICT:
      return "rejected";
    case ErrorCategory.RATE_LIMIT:
      return "rate_limited";
    default:
      return "internal";
  }
}
