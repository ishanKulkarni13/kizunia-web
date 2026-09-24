/**
 * Billing — Structured Logging
 *
 * A thin, module-scoped wrapper over the shared logger (`lib/logger`), the same
 * shape as `modules/notifications/observability/log.ts`.
 *
 * Billing's durable record is its tables — grant audit entries, and later
 * subscription history and operations. Logs cover what those tables do not:
 * that an action happened now, by whom, for querying and alerting. Events are
 * named `area.thing_that_happened` (e.g. `grant.created`). Later phases add
 * `billing.alert` events here for conditions that need a human.
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
