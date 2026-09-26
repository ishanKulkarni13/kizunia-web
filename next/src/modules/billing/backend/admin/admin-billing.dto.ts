/**
 * Billing — Admin Tool DTOs (Phase VIII)
 *
 * What the admin billing API returns. Dates are ISO strings. Imported
 * type-only by the admin UI client.
 *
 * Provider reference ids (a provider subscription id, a webhook's provider
 * event id, a payment or refund id) appear here as opaque strings for the
 * runbook's Dashboard cross-checks: this is billing-module admin tooling
 * (SB-PB-04 amended, IB-28 item 5). A raw provider payload never appears in
 * any of these shapes; it has its own SUPER_ADMIN-only endpoint.
 */
import type {
  BillingAnomalyType,
  BillingCycle,
  BillingEventStatus,
  BillingOperationKind,
  BillingOperationStatus,
  BillingActorKind,
  HistoryCause,
  HistoryChange,
  HistoryTrigger,
  MembershipPlan,
  MoneyFactKind,
  ProviderFailureClass,
  ProviderMode,
  SubscriptionKind,
  SubscriptionPhase,
  SyncReason,
} from "@/generated/prisma";
import type { EffectivePlan, GrantState, SubscriptionContribution } from "@/lib/entitlements";
import type { PaginationMeta } from "@/lib/search/types";

/** What the viewer may do; computed on the server, never trusted from the client. */
export interface BillingAdminPermissionsDTO {
  /** Immediate cancel, anomaly resolution, bulk re-sync (MANAGE_BILLING, SUPER_ADMIN). */
  readonly canManageBilling: boolean;
  /** The raw provider payload of a webhook (SUPER_ADMIN). */
  readonly canViewRawPayloads: boolean;
}

export interface BillingUserDTO {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

// -- Explain -----------------------------------------------------------------

export interface ExplainedDefaultSourceDTO {
  readonly kind: "DEFAULT";
  readonly plan: "FREE";
  readonly contributes: true;
}

export interface ExplainedSubscriptionSourceDTO {
  readonly kind: "SUBSCRIPTION";
  readonly subscriptionId: string;
  readonly plan: EffectivePlan;
  readonly phase: SubscriptionPhase;
  readonly providerMode: ProviderMode;
  readonly contribution: SubscriptionContribution;
  readonly contributes: boolean;
  /** Decoration, looked up by id; never an input to the decision above. */
  readonly subscription: {
    readonly kind: SubscriptionKind;
    readonly cycle: BillingCycle;
    /** When it entered its current phase, per its latest history entry. */
    readonly phaseSince: string | null;
    readonly providerSubscriptionId: string | null;
    readonly providerStatus: string | null;
    readonly currentPeriodEnd: string | null;
    readonly cancelAtPeriodEnd: boolean;
    readonly lastSyncedAt: string | null;
    readonly syncDueAt: string | null;
    readonly syncReason: SyncReason | null;
    readonly syncAttempts: number;
    readonly lastSyncFailureClass: ProviderFailureClass | null;
    readonly createdAt: string;
  } | null;
}

export interface ExplainedGrantSourceDTO {
  readonly kind: "GRANT";
  readonly grantId: string;
  readonly source: string;
  readonly plan: EffectivePlan;
  readonly state: GrantState;
  readonly contributes: boolean;
  readonly validFrom: string;
  readonly validUntil: string | null;
  /** Decoration: who granted it and why. */
  readonly grant: {
    readonly reason: string;
    readonly grantedBy: { readonly id: string; readonly name: string | null } | null;
    readonly promotionId: string | null;
    readonly revokedAt: string | null;
    readonly revokeReason: string | null;
  } | null;
}

export type ExplainedSourceDTO =
  | ExplainedDefaultSourceDTO
  | ExplainedSubscriptionSourceDTO
  | ExplainedGrantSourceDTO;

export interface AccessExplanationDTO {
  readonly user: BillingUserDTO;
  readonly at: string;
  readonly expectedMode: ProviderMode;
  readonly plan: EffectivePlan;
  readonly sources: readonly ExplainedSourceDTO[];
  readonly winningSource:
    | { readonly kind: "DEFAULT" }
    | { readonly kind: "SUBSCRIPTION"; readonly subscriptionId: string }
    | { readonly kind: "GRANT"; readonly grantId: string };
  /** Anomalies still open for this user. */
  readonly openAnomalies: readonly AnomalySummaryDTO[];
  readonly permissions: BillingAdminPermissionsDTO;
}

// -- Timeline ----------------------------------------------------------------

interface TimelineEntryBase {
  readonly id: string;
  /** When it happened: recorded, created, received or occurred. */
  readonly at: string;
  readonly subscriptionId: string | null;
}

export interface HistoryTimelineEntryDTO extends TimelineEntryBase {
  readonly kind: "HISTORY";
  readonly change: HistoryChange;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly cause: HistoryCause;
  readonly trigger: HistoryTrigger;
  readonly operationId: string | null;
  readonly billingEventId: string | null;
  readonly actorUserId: string | null;
  readonly observationAt: string | null;
}

export interface OperationTimelineEntryDTO extends TimelineEntryBase {
  readonly kind: "OPERATION";
  readonly operationKind: BillingOperationKind;
  readonly status: BillingOperationStatus;
  readonly actorKind: BillingActorKind;
  readonly actorUserId: string | null;
  readonly parentOperationId: string | null;
  readonly providerMode: ProviderMode;
  readonly requestSentAt: string | null;
  readonly resolvedAt: string | null;
  readonly failureClass: ProviderFailureClass | null;
  readonly providerErrorCode: string | null;
  readonly providerErrorDescription: string | null;
  /** Whitelisted scalar fields of the recorded request (reason, note, plan, cycle, …). */
  readonly request: Readonly<Record<string, string | number | boolean | null>>;
}

export interface EventTimelineEntryDTO extends TimelineEntryBase {
  readonly kind: "EVENT";
  readonly eventType: string;
  readonly providerMode: ProviderMode;
  readonly status: BillingEventStatus;
  /** Razorpay's event id (or the derived dedupe key), for the Dashboard and the ngrok inspector. */
  readonly providerEventId: string;
  readonly dedupeSource: string;
  readonly providerSubscriptionId: string | null;
  readonly providerCreatedAt: string | null;
  readonly matchedSecret: string;
  readonly duplicateCount: number;
  /** Whether the raw payload is still retained. The payload itself is never in the timeline. */
  readonly hasPayload: boolean;
  readonly payloadPrunedAt: string | null;
}

export interface MoneyFactTimelineEntryDTO extends TimelineEntryBase {
  readonly kind: "MONEY_FACT";
  readonly factKind: MoneyFactKind;
  readonly providerMode: ProviderMode;
  readonly providerObjectId: string;
  readonly providerInvoiceId: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly billingEventId: string | null;
}

export type TimelineEntryDTO =
  | HistoryTimelineEntryDTO
  | OperationTimelineEntryDTO
  | EventTimelineEntryDTO
  | MoneyFactTimelineEntryDTO;

export interface TimelineSubscriptionDTO {
  readonly id: string;
  readonly kind: SubscriptionKind;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  readonly phase: SubscriptionPhase;
  readonly providerMode: ProviderMode;
  readonly createdAt: string;
}

export interface BillingTimelineDTO {
  readonly userId: string | null;
  /** Set when the timeline is for one subscription. */
  readonly subscriptionId: string | null;
  readonly subscriptions: readonly TimelineSubscriptionDTO[];
  /** Newest first. */
  readonly entries: readonly TimelineEntryDTO[];
  /** A source hit its per-request cap; older entries of that source are not shown. */
  readonly truncated: boolean;
  readonly permissions: BillingAdminPermissionsDTO;
}

export type RawPayloadDTO =
  | { readonly billingEventId: string; readonly pruned: false; readonly payload: unknown }
  | { readonly billingEventId: string; readonly pruned: true; readonly prunedAt: string | null };

// -- Anomalies ---------------------------------------------------------------

export interface AnomalySummaryDTO {
  readonly id: string;
  readonly type: BillingAnomalyType;
  readonly providerMode: ProviderMode;
  readonly subjectKey: string;
  readonly userId: string | null;
  readonly subscriptionIds: readonly string[];
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly occurrences: number;
  readonly resolvedAt: string | null;
}

export interface AnomalyDetailDTO extends AnomalySummaryDTO {
  readonly providerSubscriptionId: string | null;
  /** Identifiers-only diagnosis written by the detector. */
  readonly details: unknown;
  readonly resolvedBy: { readonly id: string; readonly name: string | null } | null;
  readonly resolutionReason: string | null;
  readonly permissions: BillingAdminPermissionsDTO;
}

export interface AnomalyListDTO {
  readonly items: readonly AnomalySummaryDTO[];
  readonly pagination: PaginationMeta;
  readonly permissions: BillingAdminPermissionsDTO;
}

// -- Bulk re-sync --------------------------------------------------------------

export interface BulkResyncResultDTO {
  readonly mode: ProviderMode;
  readonly dryRun: boolean;
  readonly lastSyncedBefore: string | null;
  /** Rows that match the filter (bound, non-terminal, current mode). */
  readonly matched: number;
  /** Rows written (0 on a dry run). */
  readonly marked: number;
}

// -- Health ------------------------------------------------------------------

export interface JobRunDTO {
  readonly taskId: string;
  readonly lastRunAt: string | null;
  readonly lastStatus: string | null;
  readonly lastError: string | null;
  readonly runCount: number;
}

export interface BillingHealthDTO {
  readonly generatedAt: string;
  /** What the viewer may do; lets the overview show the bulk re-sync panel only to SUPER_ADMIN. */
  readonly permissions: BillingAdminPermissionsDTO;
  /** The resolved provider mode: `TEST`, `LIVE`, or `DISABLED`. */
  readonly providerMode: ProviderMode | "DISABLED";
  /** The mode whose subscriptions grant access (BILLING_EXPECTED_MODE). */
  readonly expectedMode: ProviderMode;
  readonly subscriptionsByPhase: readonly {
    readonly providerMode: ProviderMode;
    readonly phase: SubscriptionPhase;
    readonly count: number;
  }[];
  readonly dueBacklog: readonly {
    readonly providerMode: ProviderMode;
    readonly count: number;
    readonly oldestDueAt: string | null;
    readonly oldestDueAgeSeconds: number | null;
  }[];
  /** The oldest due subscriptions (bounded), for the runbook's "use sync now". */
  readonly oldestDue: readonly {
    readonly subscriptionId: string;
    readonly userId: string | null;
    readonly providerMode: ProviderMode;
    readonly syncDueAt: string;
    readonly syncReason: SyncReason | null;
    readonly syncAttempts: number;
    readonly lastSyncFailureClass: ProviderFailureClass | null;
  }[];
  readonly openAnomaliesByType: readonly { readonly type: BillingAnomalyType; readonly count: number }[];
  readonly outcomeUnknown: {
    readonly count: number;
    readonly oldestCreatedAt: string | null;
    readonly oldestAgeSeconds: number | null;
    /** The oldest (bounded), for the runbook's review step. */
    readonly oldest: readonly {
      readonly operationId: string;
      readonly kind: BillingOperationKind;
      readonly providerMode: ProviderMode;
      readonly userId: string | null;
      readonly subscriptionId: string | null;
      readonly createdAt: string;
      readonly ageSeconds: number;
    }[];
  };
  /** The last run of each billing task through the tick (`internal_job_run`). */
  readonly jobs: readonly JobRunDTO[];
  readonly providerState: readonly {
    readonly providerMode: ProviderMode;
    readonly cooldownActive: boolean;
    readonly cooldownUntil: string | null;
    readonly cooldownLevel: number;
    readonly consecutiveFailures: number;
    /** An authentication failure is pinned; it lifts itself once the configured key changes. */
    readonly authFailurePinned: boolean;
    readonly orphanWatermark: string | null;
    readonly orphanWindowTo: string | null;
  }[];
  readonly webhooks: readonly {
    readonly providerMode: ProviderMode;
    readonly lastReceivedAt: string | null;
    readonly lastReceivedAgeSeconds: number | null;
    /** The last event verified by the previous secret (rotation step 3); `null` when none. */
    readonly lastPreviousSecretMatchAt: string | null;
  }[];
}
