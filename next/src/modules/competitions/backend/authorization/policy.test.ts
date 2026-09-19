import { describe, expect, it } from "vitest";

import type { Competition, CompetitionMember } from "@/generated/prisma";
import { PlatformRole } from "@/authorization/platform/roles";
import type { AuthorizationActor } from "@/authorization";
import { CompetitionVisibility } from "@/generated/prisma";

import { CompetitionAction } from "./actions";
import type { CompetitionContext } from "./context";
import { CompetitionPolicy } from "./policy";

const VISIBILITIES = Object.values(CompetitionVisibility);

function createContext({
  visibility,
  actor = { id: "user-1", role: PlatformRole.USER, banned: false },
  membership = null,
  deletedAt = null,
}: {
  visibility: CompetitionVisibility;
  actor?: AuthorizationActor;
  membership?: CompetitionMember | null;
  deletedAt?: Date | null;
}): CompetitionContext {
  return {
    actor,
    competition: {
      visibility,
      deletedAt,
    } as Competition,
    membership,
  };
}

function canView(context: CompetitionContext): boolean {
  return CompetitionPolicy.can(context, CompetitionAction.VIEW).allowed;
}

describe("CompetitionPolicy VIEW", () => {
  it.each([
    [CompetitionVisibility.PUBLIC, true],
    [CompetitionVisibility.UNLISTED, true],
    [CompetitionVisibility.PRIVATE, false],
    [CompetitionVisibility.ARCHIVED, false],
  ])("allows non-members according to visibility: %s", (visibility, expected) => {
    expect(canView(createContext({ visibility }))).toBe(expected);
  });

  it.each(VISIBILITIES)("allows members to view %s competitions", (visibility) => {
    expect(
      canView({
        ...createContext({ visibility }),
        membership: { role: "MAINTAINER" } as CompetitionMember,
      }),
    ).toBe(true);
  });

  it.each(VISIBILITIES)("allows platform admins to view %s competitions", (visibility) => {
    expect(
      canView(
        createContext({
          visibility,
          actor: { id: "admin-1", role: PlatformRole.ADMIN, banned: false },
        }),
      ),
    ).toBe(true);
  });

  it.each(VISIBILITIES)("denies banned actors from %s competitions", (visibility) => {
    expect(
      canView(
        createContext({
          visibility,
          actor: { id: "banned-1", role: PlatformRole.USER, banned: true },
        }),
      ),
    ).toBe(false);
  });

  it.each(VISIBILITIES)("denies access to deleted %s competitions", (visibility) => {
    expect(
      canView(
        createContext({
          visibility,
          actor: { id: "member-1", role: PlatformRole.USER, banned: false },
          membership: { role: "MAINTAINER" } as CompetitionMember,
          deletedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ),
    ).toBe(false);
  });
});
