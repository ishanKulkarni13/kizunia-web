import type { ErrorResponse } from "./response-body";

export class ApiError extends Error {
  readonly status: number;

  readonly code: string;

  readonly category: string;

  readonly retryable: boolean;

  readonly details?: unknown;

  constructor(
    status: number,
    error: ErrorResponse["error"],
  ) {
    super(error.message);

    this.name = "ApiError";

    this.status = status;
    this.code = error.code;
    this.category = error.category;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}