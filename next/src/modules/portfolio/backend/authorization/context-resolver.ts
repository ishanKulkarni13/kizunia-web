import type { AuthorizationActor } from "@/authorization";

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

    return this.fromData({
      actor,
      portfolio,
    });
  }

  /**
   * Creates a context for portfolio creation.
   */
  static forCreate({
    actor,
  }: {
    actor: AuthorizationActor;
  }): PortfolioContext {
    return this.fromData({
      actor,
      portfolio: null,
    });
  }

  /**
   * Context for an unauthenticated public read. The public portfolio
   * endpoint carries no session, so the actor is anonymous: never the
   * owner, never a platform admin, never banned. `ownerBanned` is read from
   * `portfolio.user.banned` — the real, freshly-fetched DB value — since
   * there is no actor to derive it from.
   */
  static forPublicRead({
    portfolio,
  }: {
    portfolio: PortfolioContext["portfolio"];
  }): PortfolioContext {
    return this.fromData({
      actor: { id: null, role: null, banned: false },
      portfolio,
    });
  }

  /**
   * Creates a context from already loaded entities.
   */
  static fromData({
    actor,
    portfolio,
  }: {
    actor: AuthorizationActor;
    portfolio: PortfolioContext["portfolio"];
  }): PortfolioContext {
    const isOwner = portfolio !== null && actor.id === portfolio.userId;

    return {
      actor,

      portfolio,

      isOwner,

      // Computed here, never by callers — the single place this axis enters
      // the authorization system.
      isPubliclyDisplayable:
        portfolio !== null &&
        resolvePortfolioPublicEligibility({ ownerUserId: portfolio.userId }),

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