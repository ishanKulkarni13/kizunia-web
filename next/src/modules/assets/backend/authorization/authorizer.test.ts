import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { PlatformRole } from "@/authorization";

import { AssetAuthorizer } from "./authorizer";

describe("AssetAuthorizer.manage", () => {
  it("throws ForbiddenError for a USER actor", () => {
    expect(() =>
      AssetAuthorizer.manage({
        actor: { id: "u1", role: PlatformRole.USER, banned: false },
      }),
    ).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError for a banned ADMIN actor", () => {
    expect(() =>
      AssetAuthorizer.manage({
        actor: { id: "u1", role: PlatformRole.ADMIN, banned: true },
      }),
    ).toThrow(ForbiddenError);
  });

  it("does not throw for an ADMIN actor", () => {
    expect(() =>
      AssetAuthorizer.manage({
        actor: { id: "u1", role: PlatformRole.ADMIN, banned: false },
      }),
    ).not.toThrow();
  });

  it("does not throw for a SUPER_ADMIN actor", () => {
    expect(() =>
      AssetAuthorizer.manage({
        actor: { id: "u1", role: PlatformRole.SUPER_ADMIN, banned: false },
      }),
    ).not.toThrow();
  });
});
