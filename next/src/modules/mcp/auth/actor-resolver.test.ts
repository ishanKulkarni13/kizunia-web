import { describe, expect, it, vi } from "vitest";

import { PlatformRole } from "@/authorization/platform/roles";

import { McpUnauthorizedError } from "../errors/mcp-error";
import type { McpPrincipal } from "./authentication";
import { McpScope } from "./scopes";

const resolveMock = vi.fn();

vi.mock("@/authorization/platform/resolver", () => ({
  PlatformContextResolver: {
    resolve: (...args: unknown[]) => resolveMock(...args),
  },
}));

 
import { McpActorResolver } from "./actor-resolver";

function principal(overrides: Partial<McpPrincipal> = {}): McpPrincipal {
  return {
    userId: "user-1",
    clientId: "client-1",
    grantedScopes: new Set([McpScope.COMPETITIONS_READ]),
    ...overrides,
  };
}

describe("McpActorResolver.resolve", () => {
  it("re-reads the actor's current role and ban state from the database", async () => {
    resolveMock.mockResolvedValueOnce({
      actor: { id: "user-1", role: PlatformRole.SUPER_ADMIN, banned: false },
    });

    const actor = await McpActorResolver.resolve(principal());

    expect(resolveMock).toHaveBeenCalledWith({
      id: "user-1",
      role: null,
      banned: null,
    });
    expect(actor).toEqual({
      id: "user-1",
      role: PlatformRole.SUPER_ADMIN,
      banned: false,
    });
  });

  it("reflects a role demoted after the token was issued (no caching)", async () => {
    // The token was minted while the user was SUPER_ADMIN; the database now
    // says USER. The resolver must report the *current* role.
    resolveMock.mockResolvedValueOnce({
      actor: { id: "user-1", role: PlatformRole.USER, banned: false },
    });

    const actor = await McpActorResolver.resolve(principal());

    expect(actor.role).toBe(PlatformRole.USER);
  });

  it("surfaces a ban rather than rejecting authentication outright", async () => {
    resolveMock.mockResolvedValueOnce({
      actor: { id: "user-1", role: PlatformRole.USER, banned: true },
    });

    const actor = await McpActorResolver.resolve(principal());

    expect(actor.banned).toBe(true);
  });

  it("converts a resolution failure (deleted user) into McpUnauthorizedError", async () => {
    resolveMock.mockRejectedValueOnce(new Error("user not found"));

    await expect(McpActorResolver.resolve(principal())).rejects.toBeInstanceOf(
      McpUnauthorizedError,
    );
  });
});
