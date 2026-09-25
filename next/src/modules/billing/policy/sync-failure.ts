/**
 * Billing — What a Failed Sync Fetch Means
 *
 * A failed provider read is never an observation (SB-RC-07): local phase, plan
 * and access stay exactly as they were. This decides only what the sync does
 * next with the row and with the rest of its batch.
 *
 *   REJECTED, NOT_FOUND            PROVIDER_MISSING   the provider does not know the stored ID
 *   BUDGET_EXHAUSTED               NOT_ATTEMPTED      nothing was sent; stop the batch
 *   AUTH_FAILURE, nothing sent     NOT_ATTEMPTED      the key is pinned; stop the batch
 *   AUTH_FAILURE, sent             RETRY              stop the batch: every call will fail
 *   RATE_LIMITED                   RETRY              stop the batch: a cooldown has begun
 *   anything else                  RETRY              back off this row, carry on
 *
 * **Missing-subscription detection (IB-23): operation context.** Razorpay
 * answers a well-formed unknown subscription ID with `400 BAD_REQUEST_ERROR`
 * (`REJECTED`), not a `404` (D12). A GET of an ID Kizunia stored has no business
 * refusal, so here, and only here, `REJECTED` (and `NOT_FOUND`, which Razorpay
 * gives only for a malformed ID) means "the provider does not recognize this
 * subscription". Classification is untouched: no description text is read.
 * A mutation never uses this interpretation; a refused command is a refusal.
 *
 * Mode mismatch is never inferred from a failure: it is detected before the
 * fetch (the row's mode) or from the fetched entity (`notes.kz_env`).
 */
import type { ProviderFailureClass } from "@/generated/prisma";

export type SyncFailureOutcome =
  /** Raise `PROVIDER_SUBSCRIPTION_MISSING`, then back off like any failure. */
  | "PROVIDER_MISSING"
  /** Back off this row: `syncAttempts + 1`, jittered delay. */
  | "RETRY"
  /** Nothing reached the provider: release the lease, leave the row due as it was. */
  | "NOT_ATTEMPTED";

export interface SyncFailureHandling {
  readonly outcome: SyncFailureOutcome;
  /** Stop claiming more work this run: the next call would fail the same way. */
  readonly stopBatch: boolean;
}

export function interpretSyncFetchFailure(
  failureClass: ProviderFailureClass,
  requestSent: boolean,
): SyncFailureHandling {
  // Refused before sending (budget, cooldown, auth pin): not the row's fault.
  if (!requestSent) return { outcome: "NOT_ATTEMPTED", stopBatch: true };

  switch (failureClass) {
    case "REJECTED":
    case "NOT_FOUND":
      return { outcome: "PROVIDER_MISSING", stopBatch: false };
    case "AUTH_FAILURE":
    case "RATE_LIMITED":
      return { outcome: "RETRY", stopBatch: true };
    case "BUDGET_EXHAUSTED":
      return { outcome: "NOT_ATTEMPTED", stopBatch: true };
    default:
      return { outcome: "RETRY", stopBatch: false };
  }
}
