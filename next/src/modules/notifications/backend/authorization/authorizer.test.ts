import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { PlatformRole } from "@/authorization";

import { NotificationAnnouncementAuthorizer } from "./authorizer";

describe("NotificationAnnouncementAuthorizer.manage", () => {
  it("throws ForbiddenError for a USER actor", () => {
    expect(() =>
      NotificationAnnouncementAuthorizer.manage({
        actor: { id: "u1", role: PlatformRole.USER, banned: false },
      }),
    ).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError for a MODERATOR actor", () => {
    expect(() =>
      NotificationAnnouncementAuthorizer.manage({
        actor: { id: "u1", role: PlatformRole.MODERATOR, banned: false },
      }),
    ).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError for a banned ADMIN actor", () => {
    expect(() =>
      NotificationAnnouncementAuthorizer.manage({
        actor: { id: "u1", role: PlatformRole.ADMIN, banned: true },
      }),
    ).toThrow(ForbiddenError);
  });

  it("does not throw for an ADMIN actor", () => {
    expect(() =>
      NotificationAnnouncementAuthorizer.manage({
        actor: { id: "u1", role: PlatformRole.ADMIN, banned: false },
      }),
    ).not.toThrow();
  });

  it("does not throw for a SUPER_ADMIN actor", () => {
    expect(() =>
      NotificationAnnouncementAuthorizer.manage({
        actor: { id: "u1", role: PlatformRole.SUPER_ADMIN, banned: false },
      }),
    ).not.toThrow();
  });
});
