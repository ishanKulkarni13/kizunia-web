/**
 * Notifications — Intent Capability
 *
 * Pure. Which subscription capability an intent requires before it may be
 * prepared or sent (Subscription IB-2).
 *
 * This is the whole of what notifications knows about plans: an intent needs
 * a *capability*, and `lib/entitlements` answers whether a user has it. No
 * plan name appears here or anywhere else in this module (SB-PL-02), so moving
 * a capability between plans never touches notification code.
 *
 * Distinct from `intent-audience.ts`, which says who an intent is *for*
 * (a platform action; the setting is hidden from everyone else). A capability
 * says who may *receive* it: the setting stays visible and stored for every
 * user, and only delivery depends on the capability (IB-16).
 *
 * Where it is enforced — the same three points as the preference:
 *
 * 1. the scheduler's eligible-user query, as a set-based filter;
 * 2. the evaluation re-check (handler / `NotificationPolicyService`);
 * 3. the delivery re-check at send time.
 *
 * Imports only the pure entitlements catalog and type-only Prisma, so this
 * file is safe in a client bundle.
 */
import type { NotificationIntent } from "@/generated/prisma";
import { Capability } from "@/lib/entitlements/catalog";

export const INTENT_REQUIRED_CAPABILITY: Readonly<
  Partial<Record<NotificationIntent, Capability>>
> = {
  REGISTRATION_CLOSING: Capability.DEADLINE_NOTIFICATIONS,
  TOP_RELEVANT_COMPETITION: Capability.RECOMMENDATIONS,
};

/** The capability `intent` requires, or `null` when every user may receive it. */
export function requiredCapabilityFor(intent: NotificationIntent): Capability | null {
  return INTENT_REQUIRED_CAPABILITY[intent] ?? null;
}
