import type { AuthorizationActor, AuthorizationContext } from "@/authorization";

import type { PortfolioAuthorizationEntity } from "../repository";

/**
 * Complete authorization context for a Portfolio.
 *
 * Portfolio has no role/membership concept — `Portfolio.userId` is
 * `@unique`, so authority is purely owner vs. non-owner. There is
 * deliberately no permission set and no `.permission()` call in
 * PortfolioPolicy.
 */
export interface PortfolioContext extends AuthorizationContext {
  actor: AuthorizationActor;

  /** Null only for the creation context, where no portfolio exists yet. */
  portfolio: PortfolioAuthorizationEntity | null;

  isOwner: boolean;

  /**
   * Whether the OWNER is currently entitled to have this portfolio shown
   * publicly. Runtime-computed, never persisted, never the same thing as
   * `portfolio.visibility` (the owner's stored preference). Gates the
   * non-owner VIEW branch only — owners always view and edit regardless of
   * entitlement state. See ./public-eligibility.ts.
   */
  isPubliclyDisplayable: boolean;

  /**
   * Whether the portfolio's OWNER is banned (not the actor — that is
   * `actor.banned`). A banned owner's portfolio is not publicly reachable.
   */
  ownerBanned: boolean;
}