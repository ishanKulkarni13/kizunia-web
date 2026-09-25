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
