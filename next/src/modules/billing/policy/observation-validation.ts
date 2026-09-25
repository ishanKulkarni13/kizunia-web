/**
 * Billing — Is This Observation Ours to Apply?
 *
 * Before an observation may change a subscription, it must be about *this*
 * subscription, in *this* mode, in terms Kizunia understands
 * (docs/architecture/subscription/implementation/synchronization.md). Checked
 * in this order, first problem wins:
 *
 *   MODE_MISMATCH    the row was created in another provider mode than the one
 *                    this process runs, or the provider's `notes.kz_env` names
 *                    another mode (a database copied between environments,
 *                    keys swapped). Raises `PROVIDER_MODE_MISMATCH`.
 *   NOTES_CONFLICT   `notes.kz_sub` names a different Kizunia subscription:
 *                    the provider object is bound to the wrong row.
 *   UNKNOWN_STATUS   a status Kizunia does not recognize (MALFORMED, alert only).
 *   UNMAPPED_PLAN    the provider plan is not in this mode's catalog (SB-PB-05).
 *
 * Absent notes are not a conflict: a subscription created from the Razorpay
 * Dashboard carries none, and only a present, different value contradicts.
 *
 * Pure.
 */
import type { BillingCycle, MembershipPlan, ProviderMode } from "@/generated/prisma";

import { KNOWN_PROVIDER_STATUSES } from "./state-mapping";

export type ObservationProblem = "MODE_MISMATCH" | "NOTES_CONFLICT" | "UNKNOWN_STATUS" | "UNMAPPED_PLAN";

export interface ObservationValidationInput {
  readonly subscriptionId: string;
  readonly rowMode: ProviderMode;
  readonly resolvedMode: ProviderMode;
  readonly rawStatus: string;
  readonly providerPlanId: string;
  readonly notes: Readonly<Record<string, string>>;
  readonly findPlan: (providerPlanId: string) => { plan: MembershipPlan; cycle: BillingCycle } | undefined;
}

export type ObservationVerdict =
  | { readonly ok: true; readonly plan: MembershipPlan; readonly cycle: BillingCycle }
  | { readonly ok: false; readonly problem: ObservationProblem; readonly detail: Readonly<Record<string, string>> };

const KNOWN = new Set<string>(KNOWN_PROVIDER_STATUSES);

export function validateObservation(input: ObservationValidationInput): ObservationVerdict {
  const notedMode = input.notes.kz_env?.trim().toUpperCase();

  if (input.rowMode !== input.resolvedMode) {
    return fail("MODE_MISMATCH", { rowMode: input.rowMode, resolvedMode: input.resolvedMode });
  }

  if (notedMode !== undefined && notedMode !== "" && notedMode !== input.resolvedMode) {
    return fail("MODE_MISMATCH", { notedMode, resolvedMode: input.resolvedMode });
  }

  const notedSubscription = input.notes.kz_sub?.trim();

  if (notedSubscription && notedSubscription !== input.subscriptionId) {
    return fail("NOTES_CONFLICT", { notedSubscriptionId: notedSubscription });
  }

  if (!KNOWN.has(input.rawStatus)) return fail("UNKNOWN_STATUS", { rawStatus: input.rawStatus });

  const entry = input.findPlan(input.providerPlanId);

  if (entry === undefined) return fail("UNMAPPED_PLAN", { providerPlanId: input.providerPlanId });

  return { ok: true, plan: entry.plan, cycle: entry.cycle };
}

function fail(problem: ObservationProblem, detail: Record<string, string>): ObservationVerdict {
  return { ok: false, problem, detail };
}
