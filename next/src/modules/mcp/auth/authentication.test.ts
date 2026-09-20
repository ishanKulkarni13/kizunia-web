import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthAccessToken } from "better-auth/plugins";

import { McpUnauthorizedError } from "../errors/mcp-error";
import { authenticateMcpToken } from "./authentication";
import { McpScope } from "./scopes";

/**
 * `mcpResourceUrl` (via `../config`) reads `BETTER_AUTH_URL`/
 * `NEXT_PUBLIC_APP_URL` lazily, inside the function, on every call — so
 * stubbing the environment per-test is enough; no module reset is needed
 * for the stub to take effect.
 */
const RESOURCE = "https://kizunia.test/api/mcp";

function baseToken(overrides: Partial<OAuthAccessToken> = {}): OAuthAccessToken {
  return {
    accessToken: "token-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    clientId: "client-1",
    userId: "user-1",
    scopes: "competitions:read",
    ...overrides,
  };
}

describe("authenticateMcpToken", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "https://kizunia.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://kizunia.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a token with no bound user", () => {
    expect(() =>
      authenticateMcpToken(baseToken({ userId: undefined as unknown as string })),
    ).toThrow(McpUnauthorizedError);
  });

  it("accepts a token with no recorded audience", () => {
    const principal = authenticateMcpToken(baseToken());

    expect(principal.userId).toBe("user-1");
    expect(principal.clientId).toBe("client-1");
    expect(principal.grantedScopes.has(McpScope.COMPETITIONS_READ)).toBe(true);
  });

  it("accepts a token whose recorded audience matches this resource", () => {
    const token = { ...baseToken(), audience: RESOURCE } as OAuthAccessToken;

    expect(() => authenticateMcpToken(token)).not.toThrow();
  });

  it("tolerates a trailing slash / case difference in the recorded audience", () => {
    const token = {
      ...baseToken(),
      audience: "HTTPS://KIZUNIA.TEST/api/mcp/",
    } as OAuthAccessToken;

    expect(() => authenticateMcpToken(token)).not.toThrow();
  });

  it("rejects a token recorded for a different resource", () => {
    const token = {
      ...baseToken(),
      audience: "https://someone-elses-server.example/mcp",
    } as OAuthAccessToken;

    expect(() => authenticateMcpToken(token)).toThrow(McpUnauthorizedError);
  });

  it("parses no capability scopes from an empty scopes string", () => {
    const principal = authenticateMcpToken(baseToken({ scopes: "" }));

    expect(principal.grantedScopes.size).toBe(0);
  });
});
