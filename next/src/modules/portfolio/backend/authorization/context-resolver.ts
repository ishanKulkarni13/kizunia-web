import type { AuthorizationActor } from "@/authorization";

import { InternalError } from "@/lib/errors";

import type { PortfolioContext } from "./context";

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
   * Creates a context from already loaded entities.
   */
  static fromData({
    actor,
    portfolio,
  }: {
    actor: AuthorizationActor;
    portfolio: PortfolioContext["portfolio"];
  }): PortfolioContext {
    return {
      actor,

      portfolio,

      isOwner:
        portfolio !== null &&
        actor.id === portfolio.userId,
    };
  }
}