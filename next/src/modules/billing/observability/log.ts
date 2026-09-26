/**
 * Billing — Structured Logging
 *
 * A thin, module-scoped wrapper over the shared logger (`lib/logger`), the same
 * shape as `modules/notifications/observability/log.ts`.
 *
 * Billing's durable record is its tables — grant audit entries, and later
 * subscription history and operations. Logs cover what those tables do not:
 * that an action happened now, by whom, for querying and alerting. Events are
 * named `area.thing_that_happened` (e.g. `grant.created`, `budget.refused`).
 * Conditions that need a human are `billing.alert` events (`logBillingAlert`).
 *
 * Never log secrets, raw provider payloads, or a user's personal data beyond
 * ids; `lib/logger` additionally sanitizes sensitive keys.
 */
import { logger } from "@/lib/logger";

const billingLogger = logger.child({ module: "billing" });

type LogFields = Readonly<Record<string, unknown>>;

export function logBillingEvent(event: string, fields: LogFields = {}): void {
  billingLogger.info(event, fields);
}

/** `fields.error`, when present, is passed to the logger as the underlying cause. */
export function logBillingError(event: string, fields: LogFields = {}): void {
  const { error, ...rest } = fields as LogFields & { error?: unknown };

  billingLogger.error(event, error, rest);
}

/**
 * How urgently an alert needs a human. Matches the severity column of the
 * alert table in docs/architecture/subscription/cross-cutting/observability.md.
 * Urgency, not a delivery mechanism: the channel that turns these events into
 * a notification is chosen in Phase IX (IB-11).
 */
export type BillingAlertSeverity = "PAGE" | "HIGH" | "MEDIUM" | "LOW";

/**
 * Every condition that emits `billing.alert`, named once
 * (docs/architecture/subscription/cross-cutting/observability.md#alerting).
 * The anomaly conditions carry the anomaly type's own name.
 */
export const BillingAlertCondition = {
  AUTH_FAILURE: "AUTH_FAILURE",
  PROVIDER_DISABLED_IN_PRODUCTION: "PROVIDER_DISABLED_IN_PRODUCTION",
  RATE_LIMITED: "RATE_LIMITED",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  SYNC_OVERDUE: "SYNC_OVERDUE",
  MALFORMED: "MALFORMED",
  WEBHOOK_SIGNATURE_FAILURES: "WEBHOOK_SIGNATURE_FAILURES",
  WEBHOOK_SIGNED_NON_JSON: "WEBHOOK_SIGNED_NON_JSON",
  WEBHOOK_SILENCE: "WEBHOOK_SILENCE",
  WEBHOOK_LATENCY: "WEBHOOK_LATENCY",
  WEBHOOK_RECORD_FAILED: "WEBHOOK_RECORD_FAILED",
  DISPUTE_RECORDED: "DISPUTE_RECORDED",
  TRIAL_CONVERSION_OVERDUE: "TRIAL_CONVERSION_OVERDUE",
  MULTIPLE_OPEN_SUBSCRIPTIONS: "MULTIPLE_OPEN_SUBSCRIPTIONS",
  UNMATCHED_PROVIDER_SUBSCRIPTION: "UNMATCHED_PROVIDER_SUBSCRIPTION",
  NOTES_CONFLICT: "NOTES_CONFLICT",
  UNMAPPED_PROVIDER_PLAN: "UNMAPPED_PROVIDER_PLAN",
  PROVIDER_MODE_MISMATCH: "PROVIDER_MODE_MISMATCH",
  PROVIDER_SUBSCRIPTION_MISSING: "PROVIDER_SUBSCRIPTION_MISSING",
  TERMINAL_STATE_CONTRADICTED: "TERMINAL_STATE_CONTRADICTED",
  /** A requested cycle-end cancellation was contradicted (I-4): the customer is still billed, or can be again. */
  CANCELLATION_NOT_EFFECTIVE: "CANCELLATION_NOT_EFFECTIVE",
  /** A command's outcome is still unknown past the alert threshold: a user may be charged without a record, or blocked. */
  OPERATION_OUTCOME_UNKNOWN: "OPERATION_OUTCOME_UNKNOWN",
  /** The provider refused a create Kizunia expected it to accept (for example a catalog misconfiguration). */
  CHECKOUT_REJECTED: "CHECKOUT_REJECTED",
  /** The provider refused a create that carried an Offer from the catalog (Phase VII): a misconfigured or expired Offer. */
  OFFER_REJECTED: "OFFER_REJECTED",
} as const;

export type BillingAlertCondition = (typeof BillingAlertCondition)[keyof typeof BillingAlertCondition];

/**
 * A condition a human should look at, as one structured `billing.alert` event
 * carrying the condition, the severity and any correlation ids. Never pass a
 * secret or a raw provider payload in `fields`.
 */
export function logBillingAlert(
  condition: string,
  severity: BillingAlertSeverity,
  fields: LogFields = {},
): void {
  billingLogger.warn("billing.alert", { ...fields, condition, severity });
}
