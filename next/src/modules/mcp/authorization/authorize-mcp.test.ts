import { describe, expect, it } from "vitest";

import { McpScopeError } from "../errors/mcp-error";
import { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";
import { requireScope } from "./authorize-mcp";

function contextWithScopes(scopes: McpScope[]): McpRequestContext {
  return {
    principal: {
      userId: "user-1",
      clientId: "client-1",
      grantedScopes: new Set(scopes),
    },
    actor: { id: "user-1", role: "user", banned: false },
    requestId: "req-1",
  };
}

describe("requireScope", () => {
  it("allows a call when the token carries the required scope", () => {
    const context = contextWithScopes([McpScope.COMPETITIONS_READ]);

    expect(() => requireScope(context, McpScope.COMPETITIONS_READ)).not.toThrow();
  });

  it("denies a call when the token lacks the required scope", () => {
    const context = contextWithScopes([McpScope.COMPETITIONS_READ]);

    expect(() => requireScope(context, McpScope.COMPETITIONS_WRITE)).toThrow(
      McpScopeError,
    );
  });

  it("denies a call from a token with no scopes at all", () => {
    const context = contextWithScopes([]);

    expect(() => requireScope(context, McpScope.COMPETITIONS_READ)).toThrow(
      McpScopeError,
    );
  });

  it("names the missing scope in the thrown error", () => {
    const context = contextWithScopes([]);

    try {
      requireScope(context, McpScope.COMPETITIONS_WRITE);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(McpScopeError);
      expect((error as McpScopeError).requiredScope).toBe(
        McpScope.COMPETITIONS_WRITE,
      );
    }
  });
});
