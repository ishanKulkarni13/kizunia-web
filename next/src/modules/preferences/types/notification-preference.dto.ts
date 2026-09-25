import type { NotificationIntent } from "@/generated/prisma";
import type { EffectivePlan } from "@/lib/entitlements/catalog";

export interface NotificationPreferenceDTO {
  readonly intent: NotificationIntent;
  /** The user's stored preference (or the intent's default). Never changed by entitlement. */
  readonly enabled: boolean;
  /**
   * Server-computed: whether the user's current effective access includes the
   * capability this intent requires (IB-16). `true` for intents that require
   * none. When `false` the preference is still stored and shown, but nothing
   * is delivered until the user is entitled.
   */
  readonly entitled: boolean;
  /**
   * The lowest plan that includes the required capability, for copy such as
   * "Requires Pro+"; `null` when the intent requires no capability.
   */
  readonly requiredPlan: EffectivePlan | null;
}
