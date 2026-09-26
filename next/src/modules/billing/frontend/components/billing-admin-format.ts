import { ApiError } from "@/lib/http";

/** Shared, display-only helpers for the admin billing views. No rule lives here: the server decides. */

export function formatDate(iso: string | null | undefined, empty = "—"): string {
  return iso ? new Date(iso).toLocaleString() : empty;
}

/** "3d 4h", "2h 5m", "45s": a coarse age for a number of seconds. */
export function formatAge(seconds: number | null | undefined, empty = "—"): string {
  if (seconds === null || seconds === undefined) return empty;
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Minor units (paise, cents) as a decimal amount with its currency code. */
export function formatMoney(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

export const userHref = (userId: string) => `/admin/billing/users/${encodeURIComponent(userId)}`;
export const anomalyHref = (anomalyId: string) => `/admin/billing/anomalies/${encodeURIComponent(anomalyId)}`;

/** The anomaly types, for the list filter. */
export const ANOMALY_TYPES = [
  "MULTIPLE_OPEN_SUBSCRIPTIONS",
  "UNMATCHED_PROVIDER_SUBSCRIPTION",
  "NOTES_CONFLICT",
  "UNMAPPED_PROVIDER_PLAN",
  "PROVIDER_MODE_MISMATCH",
  "PROVIDER_SUBSCRIPTION_MISSING",
  "CANCELLATION_NOT_EFFECTIVE",
  "TERMINAL_STATE_CONTRADICTED",
  "TRIAL_CONVERSION_OVERDUE",
] as const;
