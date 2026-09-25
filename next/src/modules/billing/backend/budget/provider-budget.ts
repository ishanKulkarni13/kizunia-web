/**
 * Billing — Outbound Request Budget
 *
 * One budget per provider mode, shared by every instance and every caller,
 * implemented on the existing rate-limit store with its atomic
 * `incrementIfBelow`: acquisition is a single "increment if below this
 * priority's ceiling", never a read followed by a write, so concurrent callers
 * on any number of instances are admitted exactly up to the ceiling.
 *
 * Fixed windows, keyed `{scope}:{mode}:{windowStart}` like every other
 * rate-limit counter. The window is part of the key, so expiry is a delete
 * rather than a reset and two windows never collide.
 *
 * This budget is not the inbound rate limiter (`lib/rate-limit` policies, which
 * protect Kizunia from clients) and not a plan quota (what a plan includes).
 * The three share nothing but the store.
 *
 * A refusal is logged with its ceiling and the count it hit. Whether that
 * becomes an error to a user (priority 1) or a "leave it due and stop the
 * batch" (2–4) is the caller's decision.
 *
 * See docs/architecture/subscription/reconciliation/provider-rate-limits.md#the-budget.
 */
import type { ProviderMode } from "@/generated/prisma";
import type { RateLimitStore } from "@/lib/rate-limit/store";

import { BUDGET_CONFIG } from "../../config/billing-config";
import { budgetCeilings, type BudgetSettings } from "../../policy/budget-ceilings";
import { logBillingEvent } from "../../observability/log";
import type { ProviderBudgetGate } from "../../provider/budgeted-provider";
import type { ProviderPriority } from "../../provider/types";

/** The counter's scope in the rate-limit store. */
const BUDGET_SCOPE = "razorpay-outbound";

export interface ProviderBudgetOptions {
  readonly store: RateLimitStore;
  readonly settings?: BudgetSettings & { readonly windowSeconds: number };
  readonly now?: () => Date;
}

export class ProviderBudget implements ProviderBudgetGate {
  private readonly store: RateLimitStore;
  private readonly settings: BudgetSettings & { readonly windowSeconds: number };
  private readonly now: () => Date;

  constructor(
    private readonly mode: ProviderMode,
    options: ProviderBudgetOptions,
  ) {
    this.store = options.store;
    this.settings = options.settings ?? BUDGET_CONFIG;
    this.now = options.now ?? (() => new Date());
  }

  async acquire(priority: ProviderPriority): Promise<boolean> {
    const ceiling = budgetCeilings(this.settings)[priority];

    const windowMs = this.settings.windowSeconds * 1_000;
    const windowStart = Math.floor(this.now().getTime() / windowMs) * windowMs;
    const key = `${BUDGET_SCOPE}:${this.mode}:${windowStart}`;

    const result = await this.store.incrementIfBelow(key, ceiling, new Date(windowStart + windowMs));

    if (result.acquired) {
      logBillingEvent("budget.acquired", { mode: this.mode, priority, ceiling, count: result.count });

      return true;
    }

    logBillingEvent("budget.refused", { mode: this.mode, priority, ceiling, reason: "CEILING" });

    return false;
  }
}
