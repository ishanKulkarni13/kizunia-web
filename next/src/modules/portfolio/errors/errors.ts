import {
  ConflictError,
  ForbiddenError,
  HttpStatus,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";



export class PortfolioNotFoundError extends NotFoundError {
  constructor() {
    super({
      code: "PORTFOLIO_NOT_FOUND",
      message: "Portfolio not found.",
    });
  }
}

export class PortfolioAlreadyExistsError extends ConflictError {
  constructor() {
    super({
      code: "PORTFOLIO_ALREADY_EXISTS",
      status: HttpStatus.CONFLICT,
      message: "The user already has a portfolio.",
    });
  }
}

// =============================================================================
// Portfolio Projects
// =============================================================================

/**
 * Raised when the composite primary key rejects a second attempt to attach
 * the same project. The database constraint is the authority here — two
 * concurrent adds can both pass a service-level pre-check.
 */
export class PortfolioProjectAlreadyExistsError extends ConflictError {
  constructor() {
    super({
      code: "PORTFOLIO_PROJECT_ALREADY_EXISTS",
      status: HttpStatus.CONFLICT,
      message: "This project is already in your portfolio.",
    });
  }
}

/**
 * Raised when a mutation scoped to `(portfolioId, projectId)` matches no row.
 * Deliberately indistinguishable from "belongs to another portfolio" — the
 * scoping makes a foreign relationship simply invisible rather than forbidden.
 */
export class PortfolioProjectNotFoundError extends NotFoundError {
  constructor() {
    super({
      code: "PORTFOLIO_PROJECT_NOT_FOUND",
      message: "This project is not in your portfolio.",
    });
  }
}

/**
 * Raised when the actor is not a member of the project they are trying to
 * attach or feature. Membership existence is the eligibility mechanism —
 * OWNER, MAINTAINER and CONTRIBUTOR all qualify. Also covers a project that
 * does not exist or has been soft-deleted, so a probe cannot distinguish the
 * two cases.
 */
export class PortfolioProjectMembershipRequiredError extends ForbiddenError {
  constructor() {
    super({
      code: "PORTFOLIO_PROJECT_MEMBERSHIP_REQUIRED",
      message:
        "You must be a member of this project to add it to your portfolio.",
    });
  }
}

export class PortfolioProjectReorderMismatchError extends ValidationError {
  constructor() {
    super({
      code: "PORTFOLIO_PROJECT_REORDER_MISMATCH",
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message:
        "Reorder must list every project in your portfolio exactly once.",
    });
  }
}

// =============================================================================
// Portfolio Testimonials
// =============================================================================

/**
 * Raised when a mutation scoped to `(portfolioId, testimonialId)` matches no
 * row. Deliberately indistinguishable from "belongs to another portfolio" —
 * the scoping makes a foreign testimonial simply invisible rather than
 * forbidden.
 */
export class PortfolioTestimonialNotFoundError extends NotFoundError {
  constructor() {
    super({
      code: "PORTFOLIO_TESTIMONIAL_NOT_FOUND",
      message: "Testimonial not found.",
    });
  }
}

export class PortfolioTestimonialReorderMismatchError extends ValidationError {
  constructor() {
    super({
      code: "PORTFOLIO_TESTIMONIAL_REORDER_MISMATCH",
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message:
        "Reorder must list every testimonial in your portfolio exactly once.",
    });
  }
}

// =============================================================================
// Portfolio Technologies
// =============================================================================

/**
 * Raised when the composite primary key rejects a second attempt to attach
 * the same Technology. The database constraint is the authority here — two
 * concurrent adds can both pass a service-level pre-check.
 */
export class PortfolioTechnologyAlreadyExistsError extends ConflictError {
  constructor() {
    super({
      code: "PORTFOLIO_TECHNOLOGY_ALREADY_EXISTS",
      status: HttpStatus.CONFLICT,
      message: "This technology is already in your portfolio.",
    });
  }
}

/**
 * Raised when a mutation scoped to `(portfolioId, technologyId)` matches no
 * row. Deliberately indistinguishable from "belongs to another portfolio" —
 * the scoping makes a foreign relationship simply invisible rather than
 * forbidden.
 */
export class PortfolioTechnologyNotFoundError extends NotFoundError {
  constructor() {
    super({
      code: "PORTFOLIO_TECHNOLOGY_NOT_FOUND",
      message: "This technology is not in your portfolio.",
    });
  }
}

export class PortfolioTechnologyReorderMismatchError extends ValidationError {
  constructor() {
    super({
      code: "PORTFOLIO_TECHNOLOGY_REORDER_MISMATCH",
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message:
        "Reorder must list every technology in your portfolio exactly once.",
    });
  }
}




