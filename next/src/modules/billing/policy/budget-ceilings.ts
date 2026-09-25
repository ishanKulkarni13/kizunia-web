/**
 * Billing — Budget Ceilings
 *
 * The four priority classes share ONE counter per provider mode and differ only
 * by the ceiling at which they are refused. Keeping the ceilings as a pure
 * function makes the headroom rule reviewable on its own:
 *
 *   P1 commands, admin "sync now"   the whole limit
 *   P2 checkout confirm, webhooks   limit − headroom reserved for P1
 *   P3 due reconciliation           limit − headroom for P1 − headroom for P2
 *   P4 orphan discovery             a small fixed ceiling, never above P3's
 *
 * A lower-priority caller is therefore refused while a higher one still has
 * room, so a background backlog can never crowd out a customer who is waiting.
 * Ceilings are monotonic: a lower priority is never allowed more than a higher.
 *
 * See docs/architecture/subscription/reconciliation/provider-rate-limits.md#the-budget.
 */
import { ProviderPriority } from "../provider/types";

export interface BudgetSettings {
  readonly limit: number;
  readonly headroomForPriority1: number;
  readonly headroomForPriority2: number;
  readonly orphanCeiling: number;
}

export function budgetCeilings(settings: BudgetSettings): Readonly<Record<ProviderPriority, number>> {
  const priority1 = Math.max(0, settings.limit);
  const priority2 = Math.max(0, priority1 - settings.headroomForPriority1);
  const priority3 = Math.max(0, priority2 - settings.headroomForPriority2);
  const priority4 = Math.max(0, Math.min(settings.orphanCeiling, priority3));

  return {
    [ProviderPriority.COMMAND]: priority1,
    [ProviderPriority.CONFIRMATION]: priority2,
    [ProviderPriority.RECONCILIATION]: priority3,
    [ProviderPriority.ORPHAN_DISCOVERY]: priority4,
  };
}
