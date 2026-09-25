import type { AuthorizationActor } from "@/authorization";
import { Capability, hasCapability } from "@/lib/entitlements";

import { InternalError } from "@/lib/errors";

import type { PortfolioContext } from "./context";
import { resolvePortfolioPublicEligibility } from "./public-eligibility";

import { PortfolioRepository } from "../repository";

export class PortfolioContextResolver {
  /**
   * Resolves the authorization context for a portfolio.
   */
  static async resolve({
    actor,
    portfolioId,
  }: {
    actor: AuthorizationActor;
    portfolioId: string;
  }): Promise<PortfolioContext> {
    const repository = new PortfolioRepository();

    const portfolio = await repository.findForAuthorization({
      id: portfolioId,
    });

    if (!portfolio) {
      throw new InternalError({
        code: "PORTFOLIO_CONTEXT_RESOLUTION_ERROR",
        status: 500,
        message: "Failed to resolve the portfolio authorization context.",
      });
    }

    // The actor may be a non-owner, so public eligibility must be real here.
    const isOwner = actor.id === portfolio.userId;

    return this.fromData({
      actor,
      portfolio,
      isPubliclyDisplayable: isOwner
        ? false
        : await resolvePortfolioPublicEligibility({ ownerUserId: portfolio.userId }),
    });
  }

  /**
   * Creates a context for portfolio creation, carrying whether the actor's
   * effective access includes the portfolio capability (IB-4). The policy
   * decides what to do with it; admins bypass it there (IB-7).
   */
  static async forCreate({
    actor,
  }: {
    actor: AuthorizationActor;
  }): Promise<PortfolioContext> {
    const actorCanCreatePortfolio = actor.id
      ? await hasCapability(actor.id, Capability.PORTFOLIO)
      : false;

    return this.fromData({
      actor,
      portfolio: null,
      actorCanCreatePortfolio,
    });
  }

  /**
   * Context for an unauthenticated public read. The public portfolio
   * endpoint carries no session, so the actor is anonymous: never the
   * owner, never a platform admin, never banned. `ownerBanned` is read from
   * `portfolio.user.banned` — the real, freshly-fetched DB value — since
   * there is no actor to derive it from.
   */
  static async forPublicRead({
    portfolio,
  }: {
    portfolio: PortfolioContext["portfolio"];
  }): Promise<PortfolioContext> {
    // The owner's effective access, resolved before the context is built
    // (IB-5), so the policy itself stays synchronous.
    const isPubliclyDisplayable =
      portfolio !== null &&
      (await resolvePortfolioPublicEligibility({ ownerUserId: portfolio.userId }));

    return this.fromData({
      actor: { id: null, role: null, banned: false },
      portfolio,
      isPubliclyDisplayable,
    });
  }

  /**
   * Creates a context from already loaded entities.
   *
   * Synchronous: the two entitlement-derived inputs are resolved by the async
   * entry points above and passed in. They default to `false` (fail closed).
   * The synchronous callers are owner paths (editing, assets, the owner's own
   * permissions DTO), whose rules never read either flag — owners always see
   * and edit their portfolio, whatever their access.
   */
  static fromData({
    actor,
    portfolio,
    isPubliclyDisplayable = false,
    actorCanCreatePortfolio = false,
  }: {
    actor: AuthorizationActor;
    portfolio: PortfolioContext["portfolio"];
    isPubliclyDisplayable?: boolean;
    actorCanCreatePortfolio?: boolean;
  }): PortfolioContext {
    const isOwner = portfolio !== null && actor.id === portfolio.userId;

    return {
      actor,

      portfolio,

      isOwner,

      // Resolved by `forPublicRead`/`resolve` from the owner's effective
      // access (./public-eligibility.ts) — the single place this axis enters
      // the authorization system.
      isPubliclyDisplayable: portfolio !== null && isPubliclyDisplayable,

      actorCanCreatePortfolio,

      // When the actor IS the owner, their own ban state (already known
      // from the session, no extra fetch) is authoritative and identical to
      // the owner's — this is the same source of truth every other module's
      // `.security(!actor.banned)` check already trusts. Otherwise, this
      // requires `portfolio.user.banned` to have actually been fetched
      // (see portfolioAuthorizationSelect / findForAuthorizationByUsername).
      ownerBanned: isOwner
        ? actor.banned === true
        : portfolio?.user.banned === true,
    };
  }
}