import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { OAuthAccessToken } from "better-auth/plugins";

import { NotFoundError } from "@/lib/errors";

import { resetMcpEventSink, setMcpEventSink, type McpEvent } from "../../observability/events";
import type { McpTool } from "../../tools/types";

const buildContextMock = vi.fn();

vi.mock("../context/build-request-context", () => ({
  buildMcpRequestContext: (...args: unknown[]) => buildContextMock(...args),
}));

// `vi.mock` factories are hoisted above the top of the module, so the tools
// they need have to be created inside `vi.hoisted` rather than as ordinary
// top-level `const`s — a plain `const echoTool = ...` above the `vi.mock`
// call below would still throw a temporal-dead-zone error once hoisted.
const { echoTool, failingTool } = vi.hoisted(() => {
  const echoTool = {
    name: "echo",
    description: "Echoes its input.",
    inputSchema: undefined as unknown,
    execute: undefined as unknown,
  };
  const failingTool = {
    name: "always_fails",
    description: "Always throws a domain NotFoundError.",
    inputSchema: undefined as unknown,
    execute: undefined as unknown,
  };
  return { echoTool, failingTool };
});

vi.mock("../../tools/registry", () => ({
  MCP_TOOLS: new Map<string, McpTool>([
    ["echo", echoTool as unknown as McpTool],
    ["always_fails", failingTool as unknown as McpTool],
  ]),
}));

// Fill in the real schema/execute now that hoisting concerns are past —
// these run at normal module-evaluation order, after the mock above is
// registered but before any test runs.
Object.assign(echoTool, {
  inputSchema: z.object({ value: z.string() }),
  execute: vi.fn(async (_context: unknown, input: { value: string }) => ({
    echoed: input.value,
  })),
});

Object.assign(failingTool, {
  inputSchema: z.object({}),
  execute: vi.fn(async () => {
    throw new NotFoundError({ code: "THING_NOT_FOUND", message: "Thing not found." });
  }),
});

 
import { dispatchMcpRequest } from "./dispatch";

function token(): OAuthAccessToken {
  return {
    accessToken: "t",
    refreshToken: "r",
    accessTokenExpiresAt: new Date(Date.now() + 1000),
    refreshTokenExpiresAt: new Date(Date.now() + 1000),
    clientId: "client-1",
    userId: "user-1",
    scopes: "competitions:read",
  };
}

const events: McpEvent[] = [];

beforeEach(() => {
  events.length = 0;
  setMcpEventSink((event) => events.push(event));

  buildContextMock.mockResolvedValue({
    principal: { userId: "user-1", clientId: "client-1", grantedScopes: new Set() },
    actor: { id: "user-1", role: "user", banned: false },
    requestId: "req-1",
  });
});

afterEach(() => {
  resetMcpEventSink();
  vi.clearAllMocks();
});

describe("dispatchMcpRequest — protocol handling", () => {
  it("rejects a malformed JSON-RPC envelope", async () => {
    const response = await dispatchMcpRequest({ not: "jsonrpc" }, token());

    expect("error" in response && response.error.code).toBe(-32600);
  });

  it("responds to initialize with protocol version and server info", async () => {
    const response = await dispatchMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      token(),
    );

    expect("result" in response).toBe(true);
    if ("result" in response) {
      expect(response.result).toMatchObject({
        serverInfo: { name: "kizunia" },
      });
    }
  });

  it("lists registered tools with JSON-Schema input schemas", async () => {
    const response = await dispatchMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      token(),
    );

    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { tools: Array<{ name: string }> };
      expect(result.tools.map((t) => t.name)).toEqual(["echo", "always_fails"]);
    }
  });

  it("returns METHOD_NOT_FOUND for an unknown method", async () => {
    const response = await dispatchMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "totally/unknown" },
      token(),
    );

    expect("error" in response && response.error.code).toBe(-32601);
  });
});

describe("dispatchMcpRequest — tools/call", () => {
  it("rejects a call to an unregistered tool", async () => {
    const response = await dispatchMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope" } },
      token(),
    );

    expect("error" in response && response.error.code).toBe(-32601);
  });

  it("rejects malformed params", async () => {
    const response = await dispatchMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: "not-an-object" },
      token(),
    );

    expect("error" in response && response.error.code).toBe(-32602);
  });

  it("validates tool input against its schema before calling execute", async () => {
    const response = await dispatchMcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { value: 123 } }, // wrong type
      },
      token(),
    );

    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).code).toBe("VALIDATION_FAILED");
    }

    expect(echoTool.execute).not.toHaveBeenCalled();
  });

  it("dispatches a successful tool call and wraps the result as text content", async () => {
    const response = await dispatchMcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { value: "hi" } },
      },
      token(),
    );

    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { content: Array<{ text: string }> };
      expect(JSON.parse(result.content[0].text)).toEqual({ echoed: "hi" });
    }

    expect(events.some((e) => e.name === "mcp.tool.succeeded" && e.tool === "echo")).toBe(
      true,
    );
  });

  it("returns a tool failure as isError:true rather than a JSON-RPC error", async () => {
    const response = await dispatchMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "always_fails" } },
      token(),
    );

    expect("error" in response).toBe(false);
    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).code).toBe("THING_NOT_FOUND");
    }

    expect(
      events.some((e) => e.name === "mcp.tool.failed" && e.outcome === "not_found"),
    ).toBe(true);
  });
});
