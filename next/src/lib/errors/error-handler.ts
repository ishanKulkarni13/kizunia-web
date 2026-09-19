import { NextResponse } from "next/server";

import { createErrorResponse } from "./error-response";
import { isAppError } from "./is-app-error";
import { ZodError } from "zod";
import { convertZodError } from "./zod";
import { ValidationFailedError } from "./validation-failed-error";
import { RateLimitError } from "./rate-limit-error";
import { rateLimitErrorHeaders } from "@/lib/rate-limit/headers";

export class ErrorHandler {
  static handle(error: unknown) {
    if (error instanceof ZodError) {
      error = new ValidationFailedError(convertZodError(error));
    }

    if (isAppError(error)) {
      if (error instanceof RateLimitError) {
        // Retry-After / RateLimit-* headers, and the same values mirrored
        // into the JSON body via `details` (set when the error was thrown —
        // see RateLimitError). This is the one place either is emitted; no
        // caller computes or duplicates a retry value itself.
        return NextResponse.json(createErrorResponse(error), {
          status: error.status,
          headers: rateLimitErrorHeaders(error),
        });
      }

      return NextResponse.json(createErrorResponse(error), {
        status: error.status,
      });
    }

    console.error(error);

    return NextResponse.json(
      {
        success: false,

        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred.",
          category: "internal",
          retryable: false,
        },
      },
      {
        status: 500,
      },
    );
  }
}
