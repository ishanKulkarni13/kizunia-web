import {
  ConflictError,
  ForbiddenError,
  HttpStatus,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

import { PortfolioErrorCode } from "./error-code";

export class PortfolioNotFoundError extends NotFoundError {
  constructor() {
    super({
      code: PortfolioErrorCode.NOT_FOUND,
      message: "Portfolio not found.",
    });
  }
}

export class PortfolioAlreadyExistsError extends ConflictError {
  constructor() {
    super({
      code: PortfolioErrorCode.ALREADY_EXISTS,
      status: HttpStatus.CONFLICT,
      message: "The user already has a portfolio.",
    });
  }
}

/**
 * Raised when creation is attempted while the user's soft-deleted portfolio
 * still exists. `Portfolio.userId` is unique and nothing is hard-deleted, so
 * a replacement row cannot exist: the owner restores the deleted one.
 */
export class PortfolioDeletedError extends ConflictError {
  constructor() {
    super({
      code: PortfolioErrorCode.DELETED,
      status: HttpStatus.CONFLICT,
      message:
        "Your portfolio was deleted. Restore it instead of creating a new one.",
    });
  }
}

/** Raised when restore is requested for a portfolio that is not deleted. */
export class PortfolioNotDeletedError extends ConflictError {
  constructor() {
    super({
      code: PortfolioErrorCode.NOT_DELETED,
      status: HttpStatus.CONFLICT,
      message: "Your portfolio is not deleted.",
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
      code: PortfolioErrorCode.PROJECT_ALREADY_EXISTS,
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
      code: PortfolioErrorCode.PROJECT_NOT_FOUND,
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
      code: PortfolioErrorCode.PROJECT_MEMBERSHIP_REQUIRED,
      message:
        "You must be a member of this project to add it to your portfolio.",
    });
  }
}

export class PortfolioProjectReorderMismatchError extends ValidationError {
  constructor() {
    super({
      code: PortfolioErrorCode.PROJECT_REORDER_MISMATCH,
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
      code: PortfolioErrorCode.TESTIMONIAL_NOT_FOUND,
      message: "Testimonial not found.",
    });
  }
}

export class PortfolioTestimonialReorderMismatchError extends ValidationError {
  constructor() {
    super({
      code: PortfolioErrorCode.TESTIMONIAL_REORDER_MISMATCH,
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
      code: PortfolioErrorCode.TECHNOLOGY_ALREADY_EXISTS,
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
      code: PortfolioErrorCode.TECHNOLOGY_NOT_FOUND,
      message: "This technology is not in your portfolio.",
    });
  }
}

export class PortfolioTechnologyReorderMismatchError extends ValidationError {
  constructor() {
    super({
      code: PortfolioErrorCode.TECHNOLOGY_REORDER_MISMATCH,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message:
        "Reorder must list every technology in your portfolio exactly once.",
    });
  }
}

