/**
 * Billing — Classifying a Mutation's Outcome
 *
 * What a provider mutation's `Outcome` means for its BillingOperation
 * (docs/architecture/subscription/commands/operation-model.md, "Classifying
 * the outcome"):
 *
 *   2xx with a valid entity                         SUCCESS
 *   refused before anything was sent               REJECTED  (budget, cooldown, auth pin,
 *     (no requestSentAt)                                      unmapped plan: plainly not applied)
 *   4xx business refusal, 429, 401/403,            REJECTED  (the request was not processed)
 *     "another operation in progress", 404
 *   timeout, reset, 5xx, malformed body            OUTCOME_UNKNOWN (it may have been applied;
 *                                                             resolved by observation, never resent)
 *   billing disabled                               DISABLED
 *
 * A 429 is `REJECTED`, not unknown: a rate-limited request was not processed.
 * A 5xx is unknown: Razorpay may have applied the change before failing.
 *
 * Pure.
 */
import type { ProviderFailureClass } from "@/generated/prisma";

import type { Outcome } from "../provider/types";

export type ClassifiedOutcome<T> =
  | { readonly kind: "SUCCESS"; readonly value: T; readonly requestSentAt: Date }
  | {
      readonly kind: "REJECTED";
      readonly failureClass: ProviderFailureClass;
      /** `null` when nothing was sent. */
      readonly requestSentAt: Date | null;
      readonly providerErrorCode: string | null;
      readonly providerErrorDescription: string | null;
    }
  | {
      readonly kind: "OUTCOME_UNKNOWN";
      readonly failureClass: ProviderFailureClass;
      readonly requestSentAt: Date;
      readonly providerErrorCode: string | null;
      readonly providerErrorDescription: string | null;
    }
  | { readonly kind: "DISABLED" };

/** Failures after which the provider may still have applied the mutation. */
const UNKNOWN_CLASSES: ReadonlySet<ProviderFailureClass> = new Set(["TIMEOUT", "UNAVAILABLE", "MALFORMED"]);

export function classifyMutationOutcome<T>(outcome: Outcome<T>): ClassifiedOutcome<T> {
  if (outcome.kind === "PROVIDER_DISABLED") return { kind: "DISABLED" };
  if (outcome.kind === "SUCCESS") return { kind: "SUCCESS", value: outcome.value, requestSentAt: outcome.observationAt };

  const details = {
    failureClass: outcome.failureClass,
    providerErrorCode: outcome.providerErrorCode ?? null,
    providerErrorDescription: outcome.providerErrorDescription ?? null,
  };

  if (outcome.requestSentAt === undefined) return { kind: "REJECTED", requestSentAt: null, ...details };

  if (UNKNOWN_CLASSES.has(outcome.failureClass)) {
    return { kind: "OUTCOME_UNKNOWN", requestSentAt: outcome.requestSentAt, ...details };
  }

  return { kind: "REJECTED", requestSentAt: outcome.requestSentAt, ...details };
}
