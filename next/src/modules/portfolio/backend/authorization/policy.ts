import {
  AuthorizationCode,
  AuthorizationDecision,
  PlatformRole,
  
} from "@/authorization";

import { PortfolioVisibility } from "@/generated/prisma";

import { PortfolioAction } from "./actions";
import { PortfolioContext } from "./context";

export class PortfolioPolicy {
  static can(
    context: PortfolioContext,
    action: PortfolioAction,
  ): AuthorizationDecision {
    if (
      context.actor.role === PlatformRole.ADMIN ||
      context.actor.role === PlatformRole.SUPER_ADMIN
    ) {
      return {
        allowed: true,
      };
    }

    switch (action) {
      case PortfolioAction.CREATE:
        return this.canCreate(context);

      case PortfolioAction.VIEW:
        return this.canView(context);

      case PortfolioAction.EDIT:
        return this.canEdit(context);

      case PortfolioAction.DELETE:
        return this.canDelete(context);

      case PortfolioAction.MANAGE_PROJECTS:
        return this.canManageProjects(context);

      case PortfolioAction.MANAGE_TESTIMONIALS:
        return this.canManageTestimonials(context);

      case PortfolioAction.MANAGE_TECHNOLOGIES:
        return this.canManageTechnologies(context);

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
    if (!context.actor.id) {
      return {
        allowed: false,
        code: AuthorizationCode.UNAUTHORIZED,
        message: "Authentication is required.",
      };
    }

    return {
      allowed: true,
    };
  }

  private static canView(
    context: PortfolioContext,
  ): AuthorizationDecision {
    if (!context.portfolio) {
      return {
        allowed: false,
        code: AuthorizationCode.UNAUTHORIZED,
        message: "Portfolio context is missing.",
      };
    }

    if (
      context.portfolio.visibility === PortfolioVisibility.PUBLIC
    ) {
      return {
        allowed: true,
      };
    }

    if (context.isOwner) {
      return {
        allowed: true,
      };
    }

    return {
      allowed: false,
      code: AuthorizationCode.UNAUTHORIZED,
      message: "You do not have permission to view this portfolio.",
    };
  }

  private static canEdit(
    context: PortfolioContext,
  ): AuthorizationDecision {
    if (!context.portfolio) {
      return {
        allowed: false,
        code: AuthorizationCode.UNAUTHORIZED,
        message: "Portfolio context is missing.",
      };
    }

    if (context.isOwner) {
      return {
        allowed: true,
      };
    }

    return {
      allowed: false,
      code: AuthorizationCode.UNAUTHORIZED,
      message: "You do not have permission to edit this portfolio.",
    };
  }

  /**
   * Relationship management is owner-only. Note this says nothing about the
   * Project on the other side of the relationship — that eligibility is a
   * membership check the service performs separately.
   */
  private static canManageProjects(
    context: PortfolioContext,
  ): AuthorizationDecision {
    if (!context.portfolio) {
      return {
        allowed: false,
        code: AuthorizationCode.UNAUTHORIZED,
        message: "Portfolio context is missing.",
      };
    }

    if (context.isOwner) {
      return {
        allowed: true,
      };
    }

    return {
      allowed: false,
      code: AuthorizationCode.UNAUTHORIZED,
      message:
        "You do not have permission to manage this portfolio's projects.",
    };
  }

  /**
   * Testimonial management is owner-only. A Testimonial is Portfolio-owned
   * content (not a reference to another domain), so this needs no separate
   * cross-domain eligibility check the way canManageProjects does.
   */
  private static canManageTestimonials(
    context: PortfolioContext,
  ): AuthorizationDecision {
    if (!context.portfolio) {
      return {
        allowed: false,
        code: AuthorizationCode.UNAUTHORIZED,
        message: "Portfolio context is missing.",
      };
    }

    if (context.isOwner) {
      return {
        allowed: true,
      };
    }

    return {
      allowed: false,
      code: AuthorizationCode.UNAUTHORIZED,
      message:
        "You do not have permission to manage this portfolio's testimonials.",
    };
  }

  /**
   * Technology relationship management is owner-only, like
   * canManageProjects/canManageTestimonials. This authorizes attach/detach
   * of the Portfolio's PortfolioTechnology rows only — never the global
   * Technology entity.
   */
  private static canManageTechnologies(
    context: PortfolioContext,
  ): AuthorizationDecision {
    if (!context.portfolio) {
      return {
        allowed: false,
        code: AuthorizationCode.UNAUTHORIZED,
        message: "Portfolio context is missing.",
      };
    }

    if (context.isOwner) {
      return {
        allowed: true,
      };
    }

    return {
      allowed: false,
      code: AuthorizationCode.UNAUTHORIZED,
      message:
        "You do not have permission to manage this portfolio's technologies.",
    };
  }

  private static canDelete(
    context: PortfolioContext,
  ): AuthorizationDecision {
    if (!context.portfolio) {
      return {
        allowed: false,
        code: AuthorizationCode.UNAUTHORIZED,
        message: "Portfolio context is missing.",
      };
    }

    if (context.isOwner) {
      return {
        allowed: true,
      };
    }

    return {
      allowed: false,
      code: AuthorizationCode.UNAUTHORIZED,
      message: "You do not have permission to delete this portfolio.",
    };
  }
}