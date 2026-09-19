import { ConflictError, HttpStatus, NotFoundError, ResourceError } from "@/lib/errors";
import { ProjectErrorCode } from "./error-code";

export class ProjectNotFoundError extends NotFoundError {
  constructor(message = "Project not found.") {
    super({
      code: ProjectErrorCode.NOT_FOUND,
      message,
    });
  }
}

export class ProjectLinkNotFoundError extends NotFoundError {
  constructor(message = "Link not found.") {
    super({
      code: ProjectErrorCode.LINK_NOT_FOUND,
      message,
    });
  }
}

export class ProjectTestimonialNotFoundError extends NotFoundError {
  constructor(message = "Testimonial not found.") {
    super({
      code: ProjectErrorCode.TESTIMONIAL_NOT_FOUND,
      message,
    });
  }
}

export class ProjectTechnologyNotFoundError extends NotFoundError {
  constructor(message = "Technology not found.") {
    super({
      code: ProjectErrorCode.TECHNOLOGY_NOT_FOUND,
      message,
    });
  }
}

export class ProjectTechnologyAlreadyAttachedError extends ConflictError {
  constructor() {
    super({
      code: ProjectErrorCode.TECHNOLOGY_ALREADY_ATTACHED,
      status: HttpStatus.CONFLICT,
      message: "Technology is already attached to this project.",
    });
  }
}

export class ProjectDeletedError extends ResourceError {
  constructor() {
    super({
      code: ProjectErrorCode.DELETED,
      status: 410,
      message: "Project has been deleted.",
    });
  }
}

export class ProjectDuplicateSlugError extends ConflictError {
  constructor(slug: string) {
    super({
      code: ProjectErrorCode.DUPLICATE_SLUG,
      status: HttpStatus.CONFLICT,
      message: `Project slug "${slug}" already exists.`,
      details: {
        slug,
      },
    });
  }
}

export class ProjectAlreadyDeletedError extends Error {
  constructor() {
    super("Project has already been deleted.");
    this.name = "ProjectAlreadyDeletedError";
  }
}

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

