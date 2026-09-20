import { describe, expect, it } from "vitest";

import { MCP_SCOPES, MCP_SUPPORTED_SCOPES } from "@/modules/mcp/auth/scopes";

/**
 * Regression test for the `invalid_scope` bug: better-auth's `mcp()`
 * validates a requested OAuth scope against `oidcConfig.scopes` (unioned
 * internally with its four built-in identity scopes), NOT against
 * `oidcConfig.metadata.scopes_supported` — that field only feeds the
 * discovery document. If Kizunia's capability scopes are ever only added to
 * `metadata.scopes_supported` again, every MCP client's authorization
 * request for `competitions:read`/`competitions:write` would be rejected.
 */
describe("auth mcp plugin scope configuration", () => {
  it("registers every Kizunia capability scope as an accepted OAuth scope", async () => {
    const { auth } = await import("@/lib/auth");
    const plugins = (auth.options as { plugins?: Array<{ id: string; options?: unknown }> })
      .plugins ?? [];
    const mcpPlugin = plugins.find((plugin) => plugin.id === "mcp");

    expect(mcpPlugin).toBeDefined();

    const oidcConfig = (
      mcpPlugin?.options as { oidcConfig?: { scopes?: string[] } } | undefined
    )?.oidcConfig;

    for (const scope of MCP_SCOPES) {
      expect(oidcConfig?.scopes).toContain(scope);
    }
  });

  it("still advertises the full scope set in discovery metadata", async () => {
    const { auth } = await import("@/lib/auth");
    const plugins = (auth.options as { plugins?: Array<{ id: string; options?: unknown }> })
      .plugins ?? [];
    const mcpPlugin = plugins.find((plugin) => plugin.id === "mcp");

    const scopesSupported = (
      mcpPlugin?.options as
        | { oidcConfig?: { metadata?: { scopes_supported?: string[] } } }
        | undefined
    )?.oidcConfig?.metadata?.scopes_supported;

    for (const scope of MCP_SUPPORTED_SCOPES) {
      expect(scopesSupported).toContain(scope);
    }
  });
});
