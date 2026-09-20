import {
  AuthorizationCode,
  AuthorizationDecision,
  AuthorizationEvaluator,
} from "@/authorization";

import { PortfolioVisibility } from "@/generated/prisma";

import { PortfolioAction } from "./actions";
import type { PortfolioContext } from "./context";

export class PortfolioPolicy {
  static can(
    context: PortfolioContext,
    action: PortfolioAction,
  ): AuthorizationDecision {
    switch (action) {
      case PortfolioAction.CREATE:
        return this.canCreate(context);

      case PortfolioAction.VIEW:
        return this.canView(context);

      case PortfolioAction.EDIT:
      case PortfolioAction.DELETE:
      case PortfolioAction.MANAGE_PROJECTS:
      case PortfolioAction.MANAGE_TESTIMONIALS:
      case PortfolioAction.MANAGE_TECHNOLOGIES:
        return this.canManage(context);

      default:
        return {
          allowed: false,
          code: AuthorizationCode.UNAUTHORIZED,
          message: "Unknown portfolio action.",
        };
    }
  }

  // ===========================================================================
  // Rules
  // ===========================================================================

  private static canCreate(
    context: PortfolioContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .platformOverride()

      .require(
        (ctx) => Boolean(ctx.actor.id),
        AuthorizationCode.UNAUTHORIZED,
        "Authentication is required.",
      )

      .grant()

      .evaluate();
  }

  private static canView(
    context: PortfolioContext,
  ): AuthorizationDecision {
    // Owners can always view their own portfolio, regardless of visibility,
    // ban-on-owner (that check only applies to non-owner/public access), or
    // public-display eligibility — losing an entitlement never locks a user
    // out of their own data.
    if (context.isOwner) {
      return AuthorizationEvaluator
        .start(context)

        .security(
          (ctx) => !ctx.actor.banned,
          AuthorizationCode.ACCOUNT_BANNED,
          "Your account has been banned.",
        )

        .platformOverride()

        .require(
          (ctx) => !ctx.portfolio?.deletedAt,
          AuthorizationCode.RESOURCE_DELETED,
          "Portfolio has been deleted.",
        )

        .grant()

        .evaluate();
    }

    // Non-owners (including anonymous public visitors) may only view a
    // PUBLIC, non-deleted portfolio whose owner is neither banned nor
    // currently ineligible for public display. Order matters: visibility is
    // checked before eligibility, so a PRIVATE portfolio always denies with
    // RESOURCE_PRIVATE, never FEATURE_DISABLED — the two failure reasons
    // stay distinguishable in the decision code even though both surface
    // identically (404) at the public HTTP boundary.
    return AuthorizationEvaluator
      .start(context)

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .platformOverride()

      .require(
        (ctx) => ctx.portfolio !== null,
        AuthorizationCode.UNAUTHORIZED,
        "Portfolio context is missing.",
      )

      .require(
        (ctx) => !ctx.portfolio?.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Portfolio has been deleted.",
      )

      .require(
        (ctx) => !ctx.ownerBanned,
        AuthorizationCode.RESOURCE_PRIVATE,
        "Portfolio owner's account has been banned.",
      )

      .require(
        (ctx) => ctx.portfolio?.visibility === PortfolioVisibility.PUBLIC,
        AuthorizationCode.RESOURCE_PRIVATE,
        "Portfolio is private.",
      )

      .require(
        (ctx) => ctx.isPubliclyDisplayable,
        AuthorizationCode.FEATURE_DISABLED,
        "Public portfolio display is not available on this account's plan.",
      )

      .grant()

      .evaluate();
  }

  /**
   * Owner-only management, covering EDIT, DELETE, MANAGE_PROJECTS,
   * MANAGE_TESTIMONIALS and MANAGE_TECHNOLOGIES — identical rules for all
   * five today. Kept as distinct PortfolioAction members (not merged into
   * one enum value) so each can diverge from the others later without
   * touching call sites:
   *
   * - MANAGE_PROJECTS authorizes only the Portfolio side of a Portfolio↔
   *   Project relationship; eligibility to attach a particular Project is a
   *   separate membership check the service performs.
   * - MANAGE_TESTIMONIALS covers Testimonial image management too — a
   *   Testimonial is Portfolio-owned content, not a reference to another
   *   domain, so it needs no separate cross-domain eligibility check.
   * - MANAGE_TECHNOLOGIES authorizes only the Portfolio's relationship rows,
   *   never the global Technology catalog (gated separately by
   *   PlatformAction.MANAGE_TECHNOLOGIES).
   *
   * `isPubliclyDisplayable`/`ownerBanned` are deliberately not checked here
   * — an owner can always manage their own portfolio regardless of public
   * display eligibility.
   */
  private static canManage(
    context: PortfolioContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .platformOverride()

      .require(
        (ctx) => ctx.portfolio !== null,
        AuthorizationCode.UNAUTHORIZED,
        "Portfolio context is missing.",
      )

      .require(
        (ctx) => !ctx.portfolio?.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Portfolio has been deleted.",
      )

      .require(
        (ctx) => ctx.isOwner,
        AuthorizationCode.OWNER_REQUIRED,
        "You do not have permission to manage this portfolio.",
      )

      .grant()

      .evaluate();
  }
}
