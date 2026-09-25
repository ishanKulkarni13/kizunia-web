import { describe, expect, it } from "vitest";

import { AuthorizationCode, type StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";

import { McpAccess } from "./mcp-access";

function actor(role: string, banned = false): StrictAuthorizationActor {
  return { id: "user-1", role, banned };
}

describe("McpAccess.decide", () => {
  it("allows an actor whose access includes MCP", () => {
    expect(McpAccess.decide({ actor: actor(PlatformRole.USER), hasMcpCapability: true }).allowed).toBe(true);
  });

  it("refuses an actor without MCP with UPGRADE_REQUIRED, naming the plan from the catalog", () => {
    const decision = McpAccess.decide({ actor: actor(PlatformRole.USER), hasMcpCapability: false });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe(AuthorizationCode.UPGRADE_REQUIRED);
    expect(decision.message).toBe("MCP access requires Pro+.");
  });

  it.each([PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN])("lets %s through (IB-7)", (role) => {
    expect(McpAccess.decide({ actor: actor(role), hasMcpCapability: false }).allowed).toBe(true);
  });

  it("does not let a moderator through", () => {
    expect(McpAccess.decide({ actor: actor(PlatformRole.MODERATOR), hasMcpCapability: false }).allowed).toBe(false);
  });

  it("refuses a banned actor as banned, even an admin with the capability", () => {
    const decision = McpAccess.decide({ actor: actor(PlatformRole.ADMIN, true), hasMcpCapability: true });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe(AuthorizationCode.ACCOUNT_BANNED);
  });
});
