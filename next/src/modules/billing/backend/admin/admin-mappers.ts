/**
 * Billing — Admin Tool Mapping Helpers (Phase VIII)
 *
 * Small shared pieces of the admin DTOs: permission flags computed from the
 * resolved platform context, date serialization, and the anomaly summary.
 */
import type { PlatformContext } from "@/authorization/platform/context";
import type { BillingAnomaly } from "@/generated/prisma";

import { BillingAuthorizer } from "../authorization/authorizer";
import type { AnomalySummaryDTO, BillingAdminPermissionsDTO } from "./admin-billing.dto";

export function adminPermissions(context: PlatformContext): BillingAdminPermissionsDTO {
  return {
    canManageBilling: BillingAuthorizer.canManageBilling(context),
    canViewRawPayloads: BillingAuthorizer.canViewRawPayloads(context),
  };
}

export function iso(date: Date): string;
export function iso(date: Date | null | undefined): string | null;
export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/** Whole seconds from `from` to `now`, never negative; `null` without a start. */
export function ageSeconds(from: Date | null | undefined, now: Date): number | null {
  if (!from) return null;

  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
}

export function toAnomalySummaryDTO(anomaly: BillingAnomaly): AnomalySummaryDTO {
  return {
    id: anomaly.id,
    type: anomaly.type,
    providerMode: anomaly.providerMode,
    subjectKey: anomaly.subjectKey,
    userId: anomaly.userId,
    subscriptionIds: anomaly.subscriptionIds,
    firstSeenAt: iso(anomaly.firstSeenAt),
    lastSeenAt: iso(anomaly.lastSeenAt),
    occurrences: anomaly.occurrences,
    resolvedAt: iso(anomaly.resolvedAt),
  };
}
