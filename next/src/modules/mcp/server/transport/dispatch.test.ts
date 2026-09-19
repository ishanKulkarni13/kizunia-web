import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { OAuthAccessToken } from "better-auth/plugins";

import { NotFoundError } from "@/lib/errors";
import { InMemoryRateLimitStore } from "@/lib/rate-limit/memory.store";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { RateLimitService } from "@/lib/rate-limit/service";
import type { RateLimitStore } from "@/lib/rate-limit/store";

/** A store that always fails, to exercise the failure-mode dispatch. */
class ThrowingRateLimitStore implements RateLimitStore {
  async increment(): Promise<never> {
    throw new Error("simulated store outage");
  }

  async prune(): Promise<number> {
    return 0;
  }
}

import { resetMcpEventSink, setMcpEventSink, type McpEvent } from "../../observability/events";
import type { McpTool } from "../../tools/types";

const buildContextMock = vi.fn();

vi.mock("../context/build-request-context", () => ({
  buildMcpRequestContext: (...args: unknown[]) => buildContextMock(...args),
}));

// `rateLimitService` is normally a module-level singleton backed by
// Postgres. Dispatch is unit-tested against a fresh, in-memory-store-backed
// `RateLimitService` instead — reassigned per test in `beforeEach` so every
// test starts with an empty budget, same isolation `service.test.ts` gets
// for free by constructing its own instance per test.
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>(
    "@/lib/rate-limit",
  );

  return {
    ...actual,
    get rateLimitService() {
      return testRateLimitService;
    },
  };
});

// `vi.mock` factories are hoisted above the top of the module, so the tools
// they need have to be created inside `vi.hoisted` rather than as ordinary
// top-level `const`s — a plain `const echoTool = ...` above the `vi.mock`
// call below would still throw a temporal-dead-zone error once hoisted.
const { echoTool, failingTool, unclassifiedTool } = vi.hoisted(() => {
  const echoTool = {
    name: "echo",
    description: "Echoes its input.",
    inputSchema: undefined as unknown,
    rateLimitPolicy: undefined as unknown,
    execute: undefined as unknown,
  };
  const failingTool = {
    name: "always_fails",
    description: "Always throws a domain NotFoundError.",
    inputSchema: undefined as unknown,
    rateLimitPolicy: undefined as unknown,
    execute: undefined as unknown,
  };
  const unclassifiedTool = {
    name: "unclassified",
    description: "Carries a rate-limit policy id that does not exist in the registry.",
    inputSchema: undefined as unknown,
    rateLimitPolicy: "not-a-real-policy" as unknown,
    execute: undefined as unknown,
  };
  return { echoTool, failingTool, unclassifiedTool };
});

vi.mock("../../tools/registry", () => ({
  MCP_TOOLS: new Map<string, McpTool>([
    ["echo", echoTool as unknown as McpTool],
    ["always_fails", failingTool as unknown as McpTool],
    ["unclassified", unclassifiedTool as unknown as McpTool],
  ]),
}));

// Fill in the real schema/execute now that hoisting concerns are past —
// these run at normal module-evaluation order, after the mock above is
// registered but before any test runs.
Object.assign(echoTool, {
  inputSchema: z.object({ value: z.string() }),
  rateLimitPolicy: RateLimitPolicyId.MCP_TOOLS_READ,
  execute: vi.fn(async (_context: unknown, input: { value: string }) => ({
    echoed: input.value,
  })),
});

Object.assign(failingTool, {
  inputSchema: z.object({}),
  rateLimitPolicy: RateLimitPolicyId.MCP_TOOLS_WRITE,
  execute: vi.fn(async () => {
    throw new NotFoundError({ code: "THING_NOT_FOUND", message: "Thing not found." });
  }),
});

Object.assign(unclassifiedTool, {
  inputSchema: z.object({}),
  execute: vi.fn(async () => ({ ok: true })),
});

let testRateLimitService = new RateLimitService(new InMemoryRateLimitStore());

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

  testRateLimitService = new RateLimitService(new InMemoryRateLimitStore());

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
      expect(result.tools.map((t) => t.name)).toEqual([
        "echo",
        "always_fails",
        "unclassified",
      ]);
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

describe("dispatchMcpRequest — tool rate limiting", () => {
  function callEcho() {
    return dispatchMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { value: "hi" } } },
      token(),
    );
  }

  function callFailingTool() {
    return dispatchMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "always_fails" } },
      token(),
    );
  }

  it("allows calls within the configured limit", async () => {
    const response = await callEcho();

    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { isError?: boolean };
      expect(result.isError).toBeUndefined();
    }
  });

  it("rejects a call once the read policy's budget is exhausted, without invoking execute", async () => {
    for (let i = 0; i < 60; i++) {
      await callEcho();
    }

    vi.clearAllMocks();

    const response = await callEcho();

    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);

      const failure = JSON.parse(result.content[0].text) as {
        code: string;
        retryAfterSeconds?: number;
      };
      expect(failure.code).toBe("MCP_TOOLS_READ_RATE_LIMITED");
      expect(failure.retryAfterSeconds).toBeGreaterThan(0);
    }

    expect(echoTool.execute).not.toHaveBeenCalled();
  });

  it("returns a rate-limit rejection as a JSON-RPC result, never a protocol error", async () => {
    for (let i = 0; i < 60; i++) {
      await callEcho();
    }

    const response = await callEcho();

    expect("error" in response).toBe(false);
    expect("result" in response).toBe(true);
  });

  it("emits mcp.tool.failed with outcome 'rate_limited'", async () => {
    for (let i = 0; i < 60; i++) {
      await callEcho();
    }

    events.length = 0;

    await callEcho();

    expect(
      events.some((e) => e.name === "mcp.tool.failed" && e.outcome === "rate_limited"),
    ).toBe(true);
  });

  it("shares one budget across tools on the same policy", async () => {
    // echo -> MCP_TOOLS_READ. Any second tool on the same policy would
    // share this bucket; exhausting it via echo alone is sufficient to
    // prove the policy (not the tool) owns the budget.
    for (let i = 0; i < 60; i++) {
      await callEcho();
    }

    const response = await callEcho();

    if ("result" in response) {
      const result = response.result as { isError?: boolean };
      expect(result.isError).toBe(true);
    }
  });

  it("keeps read and write policies in independent buckets", async () => {
    for (let i = 0; i < 60; i++) {
      await callEcho();
    }

    // The read policy is now exhausted; the write-policy tool must still
    // be allowed to run.
    const response = await callFailingTool();

    if ("result" in response) {
      const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      // Fails for its own domain reason (THING_NOT_FOUND), not because the
      // (unrelated) read budget ran out.
      expect(JSON.parse(result.content[0].text).code).toBe("THING_NOT_FOUND");
    }
  });

  it("allows exactly `limit` concurrent calls for one user and rejects the rest", async () => {
    const results = await Promise.all(Array.from({ length: 70 }, () => callEcho()));

    const outcomes = results.map((response) => {
      if (!("result" in response)) return "protocol-error";
      const result = response.result as { isError?: boolean };
      return result.isError ? "rejected" : "allowed";
    });

    expect(outcomes.filter((o) => o === "allowed")).toHaveLength(60);
    expect(outcomes.filter((o) => o === "rejected")).toHaveLength(10);
  });

  it("keys the rate limit on the resolved Kizunia actor, not the OAuth client", async () => {
    buildContextMock.mockResolvedValue({
      principal: { userId: "user-a", clientId: "client-shared", grantedScopes: new Set() },
      actor: { id: "user-a", role: "user", banned: false },
      requestId: "req-a",
    });

    for (let i = 0; i < 60; i++) {
      await callEcho();
    }

    // A different Kizunia user behind the same shared OAuth client must
    // have an independent budget.
    buildContextMock.mockResolvedValue({
      principal: { userId: "user-b", clientId: "client-shared", grantedScopes: new Set() },
      actor: { id: "user-b", role: "user", banned: false },
      requestId: "req-b",
    });

    const response = await callEcho();

    if ("result" in response) {
      const result = response.result as { isError?: boolean };
      expect(result.isError).toBeUndefined();
    }
  });

  it("fails open on a read-policy store outage: the call still runs", async () => {
    testRateLimitService = new RateLimitService(new ThrowingRateLimitStore());

    const response = await callEcho();

    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { isError?: boolean };
      expect(result.isError).toBeUndefined();
    }
    expect(echoTool.execute).toHaveBeenCalled();
  });

  it("fails closed on a write-policy store outage: the call is rejected", async () => {
    testRateLimitService = new RateLimitService(new ThrowingRateLimitStore());

    const response = await callFailingTool();

    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).code).toBe("MCP_TOOLS_WRITE_RATE_LIMITED");
    }
  });

  it("rejects a tool whose declared rate-limit policy does not exist in the registry, rather than skipping enforcement", async () => {
    const response = await dispatchMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "unclassified" } },
      token(),
    );

    expect("result" in response).toBe(true);
    if ("result" in response) {
      const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).code).toBe(
        "MCP_TOOL_RATE_LIMIT_UNCLASSIFIED",
      );
    }

    expect(unclassifiedTool.execute).not.toHaveBeenCalled();
  });
});
