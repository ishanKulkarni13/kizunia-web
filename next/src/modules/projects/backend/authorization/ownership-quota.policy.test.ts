import { describe, expect, it } from "vitest";

import { AuthorizationCode, type AuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import { ForbiddenError } from "@/lib/errors";

import { ProjectAuthorizer } from "./authorizer";
import { ProjectPolicy } from "./policy";

const user: AuthorizationActor = { id: "user-1", role: PlatformRole.USER, banned: false };

function decide(owned: number, limit: number, actor: AuthorizationActor = user) {
  return ProjectPolicy.canCreateOwned({ actor, owned, limit });
}

describe("ProjectPolicy.canCreateOwned (owned-project quota)", () => {
  it("allows while the actor is under the quota", () => {
    expect(decide(0, 5).allowed).toBe(true);
    expect(decide(4, 5).allowed).toBe(true);
  });

  it("refuses at the quota with UPGRADE_REQUIRED", () => {
    const decision = decide(5, 5);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe(AuthorizationCode.UPGRADE_REQUIRED);
    expect(decision.message).toBe("You have reached your plan's limit of 5 owned projects.");
  });

  it("refuses above the quota (a downgraded user keeps projects but cannot add more)", () => {
    expect(decide(12, 5).allowed).toBe(false);
  });

  it.each([PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN])("lets %s bypass the quota (IB-7)", (role) => {
    expect(decide(50, 5, { id: "admin-1", role, banned: false }).allowed).toBe(true);
  });

  it("does not let a moderator bypass the quota", () => {
    expect(decide(5, 5, { id: "mod-1", role: PlatformRole.MODERATOR, banned: false }).allowed).toBe(false);
  });

  it("refuses a banned admin as banned, not as over quota", () => {
    const decision = decide(0, 5, { id: "admin-1", role: PlatformRole.ADMIN, banned: true });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe(AuthorizationCode.ACCOUNT_BANNED);
  });
});

describe("ProjectAuthorizer.createOwned", () => {
  it("throws a 403 carrying { limit, owned } so the client can explain the refusal", () => {
    let thrown: unknown;

    try {
      ProjectAuthorizer.createOwned({ actor: user, owned: 10, limit: 10 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ForbiddenError);
    const error = thrown as ForbiddenError;
    expect(error.status).toBe(403);
    expect(error.code).toBe(AuthorizationCode.UPGRADE_REQUIRED);
    expect(error.details).toEqual({ limit: 10, owned: 10 });
  });

  it("does not throw under the quota", () => {
    expect(() => ProjectAuthorizer.createOwned({ actor: user, owned: 9, limit: 10 })).not.toThrow();
  });
});
