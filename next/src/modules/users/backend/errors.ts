/**
 * Users Module — Errors
 *
 * Feature-specific error classes. All feature errors inherit from AppError
 * (via the shared @/lib/errors subclasses) so Route.execute/ErrorHandler can
 * serialize them into the correct HTTP status/response shape — a plain
 * `Error` subclass falls through to a generic 500 instead.
 */

import { ConflictError, NotFoundError } from "@/lib/errors";

export class UserNotFoundError extends NotFoundError {
  constructor(message = "User not found.") {
    super({ code: "USER_NOT_FOUND", message });
  }
}

export class UserAlreadyExistsError extends ConflictError {
  constructor(message = "A user with this email already exists.") {
    super({ code: "USER_ALREADY_EXISTS", status: 409, message });
  }
}
