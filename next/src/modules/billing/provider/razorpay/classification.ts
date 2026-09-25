/**
 * Razorpay — Failure Classification
 *
 * Turns an HTTP failure into exactly one `ProviderFailureClass`, by **status
 * and code only**. The description text is never read, with one documented
 * exception (below). Razorpay's descriptions vary by request and by case, and
 * the same refusal reads differently from one call to the next (D8, D10), so
 * matching on them would silently reclassify a permanent refusal the day a
 * word changes.
 *
 * | Signal                                          | Class                  |
 * | ----------------------------------------------- | ---------------------- |
 * | 401, 403                                        | `AUTH_FAILURE`         |
 * | 404                                             | `NOT_FOUND`            |
 * | 429                                             | `RATE_LIMITED`         |
 * | 408; a client timeout or reset (no response)    | `TIMEOUT`              |
 * | 5xx; code `SERVER_ERROR` or `GATEWAY_ERROR`     | `UNAVAILABLE`          |
 * | 400 `BAD_REQUEST_ERROR`, and any other 4xx      | `REJECTED`             |
 * | 400 whose text says another operation is in progress | `CONCURRENT_OPERATION` |
 * | anything else (1xx, 3xx)                        | `MALFORMED`            |
 *
 * A 2xx is not classified here: it is a success only once the body has been
 * validated and mapped, and a 2xx that fails that is `MALFORMED`
 * (`mapping.ts`).
 *
 * The one exception: the design names "another subscription operation is in
 * progress" as its own class, because it means *retry shortly and re-read*
 * rather than *give up*, and Razorpay gives it no distinguishing code. So the
 * 400 text is matched for it and nothing else. Its exact wording has not been
 * observed (it cannot be provoked on demand), so the match is tolerant, and a
 * miss degrades to `REJECTED` — the safe fallback the design names: the
 * caller marks the subscription sync-due and reads the truth.
 *
 * See docs/architecture/subscription/implementation/provider-boundary.md.
 */
import type { ProviderFailureClass } from "@/generated/prisma";

import type { ProviderFailureDetails } from "../types";

/** Long enough to diagnose, short enough that a verbose body cannot bloat a row. */
const MAX_DESCRIPTION_LENGTH = 500;

const CONCURRENT_OPERATION_TEXT = /another[^.]*operation[^.]*in progress/i;

export interface ClassifiedFailure extends ProviderFailureDetails {
  readonly failureClass: ProviderFailureClass;
}

interface ProviderErrorBody {
  readonly code?: string;
  readonly description?: string;
}

/** Reads `{ error: { code, description } }`, tolerating any other shape. */
function readErrorBody(body: unknown): ProviderErrorBody {
  if (typeof body !== "object" || body === null) return {};

  const error = (body as { error?: unknown }).error;

  if (typeof error !== "object" || error === null) return {};

  const { code, description } = error as { code?: unknown; description?: unknown };

  return {
    code: typeof code === "string" ? code : undefined,
    description: typeof description === "string" ? description : undefined,
  };
}

function classifyStatus(status: number, code: string | undefined): ProviderFailureClass {
  if (status === 401 || status === 403) return "AUTH_FAILURE";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408) return "TIMEOUT";
  if (status >= 500 && status <= 599) return "UNAVAILABLE";

  // A provider-side fault is reported with these codes even on a 4xx status.
  if (code === "SERVER_ERROR" || code === "GATEWAY_ERROR") return "UNAVAILABLE";

  if (status >= 400 && status <= 499) return "REJECTED";

  return "MALFORMED";
}

/**
 * Classifies a non-2xx response. `body` is the parsed JSON, or `undefined` when
 * it could not be parsed.
 */
export function classifyHttpFailure(status: number, body: unknown): ClassifiedFailure {
  const { code, description } = readErrorBody(body);

  let failureClass = classifyStatus(status, code);

  // The single place a description is matched; see the header.
  if (failureClass === "REJECTED" && description && CONCURRENT_OPERATION_TEXT.test(description)) {
    failureClass = "CONCURRENT_OPERATION";
  }

  return {
    failureClass,
    ...(code !== undefined && { providerErrorCode: code }),
    ...(description !== undefined && {
      providerErrorDescription: description.slice(0, MAX_DESCRIPTION_LENGTH),
    }),
  };
}
