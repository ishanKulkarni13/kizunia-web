import { describe, expect, it } from "vitest";

import type { AuthorizationActor, AuthorizationDecision } from "@/authorization";
import { AuthorizationCode } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import { PortfolioVisibility } from "@/generated/prisma";

import { PortfolioAction } from "./actions";
import type { PortfolioContext } from "./context";
import { PortfolioPolicy } from "./policy";

/**
 * `AuthorizationDecision` is a discriminated union on `allowed` — `.code`
 * only exists on the denied variant. This narrows it properly (rather than
 * an unchecked cast) so a decision that unexpectedly turns out allowed
 * fails loudly instead of reading `undefined`.
 */
function expectDenied(decision: AuthorizationDecision, code: AuthorizationCode) {
  expect(decision.allowed).toBe(false);
  if (decision.allowed) {
    throw new Error("unreachable: decision.allowed was just asserted false");
  }
  expect(decision.code).toBe(code);
}

const OWNER_ID = "owner-1";
const OTHER_ID = "other-1";

function createContext({
  actor = { id: OWNER_ID, role: PlatformRole.USER, banned: false },
  visibility = PortfolioVisibility.PUBLIC,
  deletedAt = null,
  ownerBannedOverride,
  isPubliclyDisplayable = true,
  actorCanCreatePortfolio = true,
  portfolio: portfolioOverride,
}: {
  actor?: AuthorizationActor;
  visibility?: PortfolioVisibility;
  deletedAt?: Date | null;
  ownerBannedOverride?: boolean;
  isPubliclyDisplayable?: boolean;
  actorCanCreatePortfolio?: boolean;
  portfolio?: PortfolioContext["portfolio"];
} = {}): PortfolioContext {
  const portfolio =
    portfolioOverride === undefined
      ? {
          id: "portfolio-1",
          userId: OWNER_ID,
          visibility,
          deletedAt,
          user: { banned: ownerBannedOverride ?? false },
        }
      : portfolioOverride;

  const isOwner = portfolio !== null && actor.id === portfolio.userId;

  return {
    actor,
    portfolio,
    isOwner,
    isPubliclyDisplayable,
    actorCanCreatePortfolio,
    ownerBanned: ownerBannedOverride ?? false,
  };
}

function decide(context: PortfolioContext, action: PortfolioAction) {
  return PortfolioPolicy.can(context, action);
}

describe("PortfolioPolicy - CREATE", () => {
  it("allows an authenticated actor", () => {
    const context = createContext({ portfolio: null });
    expect(decide(context, PortfolioAction.CREATE).allowed).toBe(true);
  });

  it("denies an actor with no id", () => {
    const context = createContext({
      actor: { id: null, role: PlatformRole.USER, banned: false },
      portfolio: null,
    });
    expectDenied(
      decide(context, PortfolioAction.CREATE),
      AuthorizationCode.UNAUTHORIZED,
    );
  });

  it("denies a banned actor, even though platformOverride would otherwise apply to an admin", () => {
    const context = createContext({
      actor: { id: OWNER_ID, role: PlatformRole.ADMIN, banned: true },
      portfolio: null,
    });
    expectDenied(
      decide(context, PortfolioAction.CREATE),
      AuthorizationCode.ACCOUNT_BANNED,
    );
  });
});

describe("PortfolioPolicy - CREATE (entitlement, IB-4 / IB-7)", () => {
  it("denies with UPGRADE_REQUIRED when the actor's access lacks the portfolio capability", () => {
    const context = createContext({ portfolio: null, actorCanCreatePortfolio: false });
    expectDenied(
      decide(context, PortfolioAction.CREATE),
      AuthorizationCode.UPGRADE_REQUIRED,
    );
  });

  it("names the lowest plan that includes portfolios, from the catalog", () => {
    const decision = decide(
      createContext({ portfolio: null, actorCanCreatePortfolio: false }),
      PortfolioAction.CREATE,
    );
    if (decision.allowed) throw new Error("expected a denial");
    expect(decision.message).toBe("Creating a portfolio requires Pro.");
  });

  it("allows when the actor's access includes the capability", () => {
    const context = createContext({ portfolio: null, actorCanCreatePortfolio: true });
    expect(decide(context, PortfolioAction.CREATE).allowed).toBe(true);
  });

  it.each([PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN])(
    "lets %s through without the capability (interactive admin bypass)",
    (role) => {
      const context = createContext({
        actor: { id: OWNER_ID, role, banned: false },
        portfolio: null,
        actorCanCreatePortfolio: false,
      });
      expect(decide(context, PortfolioAction.CREATE).allowed).toBe(true);
    },
  );

  it("does not let a moderator through without the capability", () => {
    const context = createContext({
      actor: { id: OWNER_ID, role: PlatformRole.MODERATOR, banned: false },
      portfolio: null,
      actorCanCreatePortfolio: false,
    });
    expectDenied(
      decide(context, PortfolioAction.CREATE),
      AuthorizationCode.UPGRADE_REQUIRED,
    );
  });

  it("never lets the capability affect an owner's edit rights", () => {
    const context = createContext({ actorCanCreatePortfolio: false, isPubliclyDisplayable: false });
    expect(decide(context, PortfolioAction.EDIT).allowed).toBe(true);
    expect(decide(context, PortfolioAction.CHANGE_VISIBILITY).allowed).toBe(true);
    expect(decide(context, PortfolioAction.MANAGE_PROJECTS).allowed).toBe(true);
  });
});

describe("PortfolioPolicy - VIEW (owner)", () => {
  it("allows the owner regardless of visibility", () => {
    for (const visibility of Object.values(PortfolioVisibility)) {
      const context = createContext({ visibility });
      expect(decide(context, PortfolioAction.VIEW).allowed).toBe(true);
    }
  });

  it("allows the owner even when not publicly displayable", () => {
    const context = createContext({
      visibility: PortfolioVisibility.PUBLIC,
      isPubliclyDisplayable: false,
    });
    expect(decide(context, PortfolioAction.VIEW).allowed).toBe(true);
  });

  it("denies a banned owner", () => {
    const context = createContext({
      actor: { id: OWNER_ID, role: PlatformRole.USER, banned: true },
    });
    expectDenied(
      decide(context, PortfolioAction.VIEW),
      AuthorizationCode.ACCOUNT_BANNED,
    );
  });

  it("denies the owner when the portfolio is deleted", () => {
    const context = createContext({ deletedAt: new Date() });
    expectDenied(
      decide(context, PortfolioAction.VIEW),
      AuthorizationCode.RESOURCE_DELETED,
    );
  });
});

describe("PortfolioPolicy - VIEW (non-owner)", () => {
  it("allows a public, eligible portfolio", () => {
    const context = createContext({
      actor: { id: OTHER_ID, role: PlatformRole.USER, banned: false },
      visibility: PortfolioVisibility.PUBLIC,
      isPubliclyDisplayable: true,
    });
    expect(decide(context, PortfolioAction.VIEW).allowed).toBe(true);
  });

  it("allows an anonymous visitor (id: null)", () => {
    const context = createContext({
      actor: { id: null, role: null, banned: false },
      visibility: PortfolioVisibility.PUBLIC,
      isPubliclyDisplayable: true,
    });
    expect(decide(context, PortfolioAction.VIEW).allowed).toBe(true);
  });

  it("allows platform admins regardless of visibility", () => {
    const context = createContext({
      actor: { id: "admin-1", role: PlatformRole.ADMIN, banned: false },
      visibility: PortfolioVisibility.PRIVATE,
    });
    expect(decide(context, PortfolioAction.VIEW).allowed).toBe(true);
  });

  it("denies a banned non-owner", () => {
    const context = createContext({
      actor: { id: OTHER_ID, role: PlatformRole.USER, banned: true },
      visibility: PortfolioVisibility.PUBLIC,
    });
    expectDenied(
      decide(context, PortfolioAction.VIEW),
      AuthorizationCode.ACCOUNT_BANNED,
    );
  });

  it("denies a deleted portfolio", () => {
    const context = createContext({
      actor: { id: OTHER_ID, role: PlatformRole.USER, banned: false },
      visibility: PortfolioVisibility.PUBLIC,
      deletedAt: new Date(),
    });
    expectDenied(
      decide(context, PortfolioAction.VIEW),
      AuthorizationCode.RESOURCE_DELETED,
    );
  });

  it("denies when the owner is banned, even if PUBLIC and eligible", () => {
    const context = createContext({
      actor: { id: OTHER_ID, role: PlatformRole.USER, banned: false },
      visibility: PortfolioVisibility.PUBLIC,
      isPubliclyDisplayable: true,
      ownerBannedOverride: true,
    });
    expectDenied(
      decide(context, PortfolioAction.VIEW),
      AuthorizationCode.RESOURCE_PRIVATE,
    );
  });

  it("denies a PRIVATE portfolio with RESOURCE_PRIVATE regardless of eligibility", () => {
    for (const isPubliclyDisplayable of [true, false]) {
      const context = createContext({
        actor: { id: OTHER_ID, role: PlatformRole.USER, banned: false },
        visibility: PortfolioVisibility.PRIVATE,
        isPubliclyDisplayable,
      });
      expectDenied(
        decide(context, PortfolioAction.VIEW),
        AuthorizationCode.RESOURCE_PRIVATE,
      );
    }
  });

  it("denies a PUBLIC but ineligible portfolio with FEATURE_DISABLED, distinct from RESOURCE_PRIVATE", () => {
    const context = createContext({
      actor: { id: OTHER_ID, role: PlatformRole.USER, banned: false },
      visibility: PortfolioVisibility.PUBLIC,
      isPubliclyDisplayable: false,
    });
    expectDenied(
      decide(context, PortfolioAction.VIEW),
      AuthorizationCode.FEATURE_DISABLED,
    );
  });
});

describe("PortfolioPolicy - management actions (EDIT, DELETE, CHANGE_VISIBILITY, MANAGE_PROJECTS, MANAGE_TESTIMONIALS, MANAGE_TECHNOLOGIES)", () => {
  const MANAGE_ACTIONS = [
    PortfolioAction.EDIT,
    PortfolioAction.DELETE,
    PortfolioAction.CHANGE_VISIBILITY,
    PortfolioAction.MANAGE_PROJECTS,
    PortfolioAction.MANAGE_TESTIMONIALS,
    PortfolioAction.MANAGE_TECHNOLOGIES,
  ];

  it.each(MANAGE_ACTIONS)("allows the owner for %s", (action) => {
    const context = createContext();
    expect(decide(context, action).allowed).toBe(true);
  });

  it.each(MANAGE_ACTIONS)(
    "allows the owner for %s even when not publicly displayable",
    (action) => {
      const context = createContext({ isPubliclyDisplayable: false });
      expect(decide(context, action).allowed).toBe(true);
    },
  );

  it.each(MANAGE_ACTIONS)("denies a non-owner for %s", (action) => {
    const context = createContext({
      actor: { id: OTHER_ID, role: PlatformRole.USER, banned: false },
    });
    expectDenied(decide(context, action), AuthorizationCode.OWNER_REQUIRED);
  });

  it.each(MANAGE_ACTIONS)("allows a platform admin for %s on another user's portfolio", (action) => {
    const context = createContext({
      actor: { id: "admin-1", role: PlatformRole.ADMIN, banned: false },
    });
    expect(decide(context, action).allowed).toBe(true);
  });

  it.each(MANAGE_ACTIONS)("denies a banned owner for %s", (action) => {
    const context = createContext({
      actor: { id: OWNER_ID, role: PlatformRole.USER, banned: true },
    });
    expectDenied(decide(context, action), AuthorizationCode.ACCOUNT_BANNED);
  });

  it.each(MANAGE_ACTIONS)("denies management of a deleted portfolio", (action) => {
    const context = createContext({ deletedAt: new Date() });
    expectDenied(decide(context, action), AuthorizationCode.RESOURCE_DELETED);
  });
});


describe("PortfolioPolicy - RESTORE", () => {
  it("allows the owner to restore a deleted portfolio", () => {
    const context = createContext({ deletedAt: new Date() });
    expect(decide(context, PortfolioAction.RESTORE).allowed).toBe(true);
  });

  it("does not itself require the portfolio to be deleted (that is a service precondition)", () => {
    const context = createContext();
    expect(decide(context, PortfolioAction.RESTORE).allowed).toBe(true);
  });

  it("allows the owner regardless of stored visibility or public eligibility", () => {
    const context = createContext({
      deletedAt: new Date(),
      visibility: PortfolioVisibility.PRIVATE,
      isPubliclyDisplayable: false,
    });
    expect(decide(context, PortfolioAction.RESTORE).allowed).toBe(true);
  });

  it("denies a non-owner", () => {
    const context = createContext({
      deletedAt: new Date(),
      actor: { id: OTHER_ID, role: PlatformRole.USER, banned: false },
    });
    expectDenied(
      decide(context, PortfolioAction.RESTORE),
      AuthorizationCode.OWNER_REQUIRED,
    );
  });

  it("denies a banned owner", () => {
    const context = createContext({
      deletedAt: new Date(),
      actor: { id: OWNER_ID, role: PlatformRole.USER, banned: true },
    });
    expectDenied(
      decide(context, PortfolioAction.RESTORE),
      AuthorizationCode.ACCOUNT_BANNED,
    );
  });

  it("denies when there is no portfolio context", () => {
    const context = createContext({ portfolio: null });
    expectDenied(
      decide(context, PortfolioAction.RESTORE),
      AuthorizationCode.UNAUTHORIZED,
    );
  });
});
