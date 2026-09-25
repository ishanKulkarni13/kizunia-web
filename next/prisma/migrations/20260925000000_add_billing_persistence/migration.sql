-- CreateEnum
CREATE TYPE "public"."BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "public"."SubscriptionKind" AS ENUM ('STANDARD', 'TRIAL');

-- CreateEnum
CREATE TYPE "public"."ProviderMode" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "public"."SubscriptionPhase" AS ENUM ('PROVISIONING', 'PENDING_AUTHENTICATION', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'HALTED', 'PAUSED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "public"."SyncReason" AS ENUM ('WEBHOOK', 'CHECKOUT_CONFIRM', 'COMMAND_CONFIRM', 'CHECKPOINT', 'HEARTBEAT', 'RETRY', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."ProviderFailureClass" AS ENUM ('TIMEOUT', 'UNAVAILABLE', 'RATE_LIMITED', 'CONCURRENT_OPERATION', 'REJECTED', 'NOT_FOUND', 'AUTH_FAILURE', 'MALFORMED', 'UNMAPPED_PLAN', 'BUDGET_EXHAUSTED');

-- CreateEnum
CREATE TYPE "public"."BillingOperationKind" AS ENUM ('CREATE_SUBSCRIPTION', 'UPDATE_PLAN', 'CANCEL_AT_CYCLE_END', 'CANCEL_IMMEDIATELY', 'CANCEL_SCHEDULED_CHANGE', 'SUPERSEDE', 'CHANGE_PLAN');

-- CreateEnum
CREATE TYPE "public"."BillingOperationStatus" AS ENUM ('IN_FLIGHT', 'SUCCEEDED', 'REJECTED', 'OUTCOME_UNKNOWN', 'NOT_APPLIED');

-- CreateEnum
CREATE TYPE "public"."BillingActorKind" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."BillingEventStatus" AS ENUM ('RECORDED', 'UNMATCHED_PENDING', 'UNMATCHED', 'SKIPPED_UNSUPPORTED');

-- CreateEnum
CREATE TYPE "public"."BillingProvider" AS ENUM ('RAZORPAY');

-- CreateEnum
CREATE TYPE "public"."MoneyFactKind" AS ENUM ('CHARGE', 'REFUND', 'DISPUTE');

-- CreateEnum
CREATE TYPE "public"."HistoryChange" AS ENUM ('PHASE', 'PLAN', 'SCHEDULED_CHANGE', 'CANCEL_AT_PERIOD_END', 'BINDING', 'SUPERSESSION');

-- CreateEnum
CREATE TYPE "public"."HistoryCause" AS ENUM ('KIZUNIA_COMMAND', 'PROVIDER_OBSERVED', 'LOCAL');

-- CreateEnum
CREATE TYPE "public"."HistoryTrigger" AS ENUM ('WEBHOOK', 'CHECKOUT_CONFIRM', 'COMMAND_RESPONSE', 'COMMAND_CONFIRM', 'CHECKPOINT', 'HEARTBEAT', 'RETRY', 'ORPHAN_DISCOVERY', 'ADMIN_SYNC', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."BillingAnomalyType" AS ENUM ('MULTIPLE_OPEN_SUBSCRIPTIONS', 'UNMATCHED_PROVIDER_SUBSCRIPTION', 'NOTES_CONFLICT', 'UNMAPPED_PROVIDER_PLAN', 'PROVIDER_MODE_MISMATCH', 'PROVIDER_SUBSCRIPTION_MISSING', 'CANCELLATION_NOT_EFFECTIVE');

-- CreateTable
CREATE TABLE "public"."subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "subjectPseudonym" TEXT,
    "kind" "public"."SubscriptionKind" NOT NULL,
    "providerMode" "public"."ProviderMode" NOT NULL,
    "plan" "public"."MembershipPlan" NOT NULL,
    "cycle" "public"."BillingCycle" NOT NULL,
    "phase" "public"."SubscriptionPhase" NOT NULL DEFAULT 'PROVISIONING',
    "providerSubscriptionId" TEXT,
    "providerPlanId" TEXT,
    "offerId" TEXT,
    "marketingCode" TEXT,
    "providerStatus" TEXT,
    "providerSnapshot" JSONB,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "chargeAt" TIMESTAMP(3),
    "startAt" TIMESTAMP(3),
    "expireBy" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "scheduledPlan" "public"."MembershipPlan",
    "scheduledCycle" "public"."BillingCycle",
    "scheduledProviderPlanId" TEXT,
    "scheduledChangeAt" TIMESTAMP(3),
    "scheduledByOperationId" TEXT,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelRequestedByOperationId" TEXT,
    "advisoryPaymentMethod" TEXT,
    "advisoryInternationalCard" BOOLEAN,
    "firstContributedAt" TIMESTAMP(3),
    "syncDueAt" TIMESTAMP(3),
    "syncReason" "public"."SyncReason",
    "syncRequestedAt" TIMESTAMP(3),
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "syncLeaseUntil" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastAppliedObservationAt" TIMESTAMP(3),
    "lastSyncFailureClass" "public"."ProviderFailureClass",
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_operation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "subjectPseudonym" TEXT,
    "subscriptionId" TEXT,
    "parentOperationId" TEXT,
    "kind" "public"."BillingOperationKind" NOT NULL,
    "status" "public"."BillingOperationStatus" NOT NULL DEFAULT 'IN_FLIGHT',
    "providerMode" "public"."ProviderMode" NOT NULL,
    "actorKind" "public"."BillingActorKind" NOT NULL,
    "actorUserId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "leaseUntil" TIMESTAMP(3),
    "requestSentAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "failureClass" "public"."ProviderFailureClass",
    "providerErrorCode" TEXT,
    "providerErrorDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_event" (
    "id" TEXT NOT NULL,
    "provider" "public"."BillingProvider" NOT NULL,
    "providerMode" "public"."ProviderMode" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "dedupeSource" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerSubscriptionId" TEXT,
    "accountId" TEXT,
    "providerCreatedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchedSecret" TEXT NOT NULL,
    "status" "public"."BillingEventStatus" NOT NULL,
    "subscriptionId" TEXT,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "rawPayload" JSONB,
    "payloadPrunedAt" TIMESTAMP(3),

    CONSTRAINT "billing_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_money_fact" (
    "id" TEXT NOT NULL,
    "kind" "public"."MoneyFactKind" NOT NULL,
    "providerMode" "public"."ProviderMode" NOT NULL,
    "providerObjectId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "userId" TEXT,
    "subjectPseudonym" TEXT,
    "billingEventId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "providerInvoiceId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_money_fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscription_history_entry" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "userId" TEXT,
    "subjectPseudonym" TEXT,
    "change" "public"."HistoryChange" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "cause" "public"."HistoryCause" NOT NULL,
    "trigger" "public"."HistoryTrigger" NOT NULL,
    "operationId" TEXT,
    "billingEventId" TEXT,
    "actorUserId" TEXT,
    "observationAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_history_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_anomaly" (
    "id" TEXT NOT NULL,
    "type" "public"."BillingAnomalyType" NOT NULL,
    "providerMode" "public"."ProviderMode" NOT NULL,
    "userId" TEXT,
    "subjectPseudonym" TEXT,
    "subscriptionIds" TEXT[],
    "providerSubscriptionId" TEXT,
    "subjectKey" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionReason" TEXT,

    CONSTRAINT "billing_anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_provider_state" (
    "providerMode" "public"."ProviderMode" NOT NULL,
    "cooldownUntil" TIMESTAMP(3),
    "cooldownLevel" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "authFailurePinnedKeyFingerprint" TEXT,
    "orphanWatermark" TIMESTAMP(3),
    "orphanWindowTo" TIMESTAMP(3),
    "orphanSkip" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_provider_state_pkey" PRIMARY KEY ("providerMode")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_supersededById_key" ON "public"."subscription"("supersededById");

-- CreateIndex
CREATE INDEX "subscription_userId_phase_idx" ON "public"."subscription"("userId", "phase");

-- CreateIndex
CREATE INDEX "subscription_providerMode_phase_idx" ON "public"."subscription"("providerMode", "phase");

-- CreateIndex
CREATE INDEX "subscription_userId_kind_idx" ON "public"."subscription"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_providerMode_providerSubscriptionId_key" ON "public"."subscription"("providerMode", "providerSubscriptionId");

-- CreateIndex
CREATE INDEX "billing_operation_status_leaseUntil_idx" ON "public"."billing_operation"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "billing_operation_userId_status_createdAt_idx" ON "public"."billing_operation"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "billing_operation_subscriptionId_createdAt_idx" ON "public"."billing_operation"("subscriptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_operation_userId_idempotencyKey_key" ON "public"."billing_operation"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "billing_event_providerSubscriptionId_receivedAt_idx" ON "public"."billing_event"("providerSubscriptionId", "receivedAt");

-- CreateIndex
CREATE INDEX "billing_event_status_receivedAt_idx" ON "public"."billing_event"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "billing_event_providerMode_receivedAt_idx" ON "public"."billing_event"("providerMode", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_event_provider_dedupeKey_key" ON "public"."billing_event"("provider", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "billing_money_fact_providerMode_kind_providerObjectId_key" ON "public"."billing_money_fact"("providerMode", "kind", "providerObjectId");

-- CreateIndex
CREATE INDEX "subscription_history_entry_subscriptionId_recordedAt_idx" ON "public"."subscription_history_entry"("subscriptionId", "recordedAt");

-- CreateIndex
CREATE INDEX "subscription_history_entry_userId_recordedAt_idx" ON "public"."subscription_history_entry"("userId", "recordedAt");

-- AddForeignKey
ALTER TABLE "public"."subscription" ADD CONSTRAINT "subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscription" ADD CONSTRAINT "subscription_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "public"."subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_operation" ADD CONSTRAINT "billing_operation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_operation" ADD CONSTRAINT "billing_operation_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_operation" ADD CONSTRAINT "billing_operation_parentOperationId_fkey" FOREIGN KEY ("parentOperationId") REFERENCES "public"."billing_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_event" ADD CONSTRAINT "billing_event_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_money_fact" ADD CONSTRAINT "billing_money_fact_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_money_fact" ADD CONSTRAINT "billing_money_fact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_money_fact" ADD CONSTRAINT "billing_money_fact_billingEventId_fkey" FOREIGN KEY ("billingEventId") REFERENCES "public"."billing_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscription_history_entry" ADD CONSTRAINT "subscription_history_entry_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscription_history_entry" ADD CONSTRAINT "subscription_history_entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscription_history_entry" ADD CONSTRAINT "subscription_history_entry_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "public"."billing_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscription_history_entry" ADD CONSTRAINT "subscription_history_entry_billingEventId_fkey" FOREIGN KEY ("billingEventId") REFERENCES "public"."billing_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_anomaly" ADD CONSTRAINT "billing_anomaly_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CustomIndex
-- The per-user command slot (IB-6): at most one IN_FLIGHT *root* operation
-- per user. Children of a composed command (SUPERSEDE, CHANGE_PLAN) run under
-- their root's slot, so they are excluded. A second root fails with P2002,
-- which the command runner (Phase V) maps to 409 BILLING_OPERATION_IN_PROGRESS.
-- Prisma has no attribute for a partial index, so the client does not know it
-- exists: IN_FLIGHT roots are created and the P2002 caught, never upserted.
CREATE UNIQUE INDEX "billing_operation_userId_in_flight_root_key"
  ON "public"."billing_operation" ("userId")
  WHERE "status" = 'IN_FLIGHT' AND "parentOperationId" IS NULL;

-- CustomIndex
-- The sync claim reads due subscriptions of one mode, oldest first. Most rows
-- are not due, so the index holds only those that are.
CREATE INDEX "subscription_providerMode_syncDueAt_due_idx"
  ON "public"."subscription" ("providerMode", "syncDueAt")
  WHERE "syncDueAt" IS NOT NULL;

-- CustomIndex
-- One OPEN anomaly per (type, subject). Raising is an upsert on the open row:
-- repeated detection bumps "lastSeenAt"/"occurrences", and a P2002 here means
-- "already open". Resolved rows are history and may repeat.
CREATE UNIQUE INDEX "billing_anomaly_type_subjectKey_open_key"
  ON "public"."billing_anomaly" ("type", "subjectKey")
  WHERE "resolvedAt" IS NULL;

-- CustomIndex
-- Payload pruning scans only events that still hold a payload.
CREATE INDEX "billing_event_receivedAt_with_payload_idx"
  ON "public"."billing_event" ("receivedAt")
  WHERE "rawPayload" IS NOT NULL;

-- CustomCheck
-- A sync attempt counter never goes negative.
ALTER TABLE "public"."subscription"
  ADD CONSTRAINT "subscription_syncAttempts_non_negative_check"
  CHECK ("syncAttempts" >= 0);

-- CustomCheck
-- A terminal subscription is never synchronized again, so it is never due.
-- Catches a buggy nextDue that would otherwise keep a finished subscription
-- in the claim queue forever.
ALTER TABLE "public"."subscription"
  ADD CONSTRAINT "subscription_terminal_not_due_check"
  CHECK ("phase" NOT IN ('CANCELLED', 'EXPIRED', 'COMPLETED', 'ABANDONED') OR "syncDueAt" IS NULL);

-- CustomCheck
-- Where an event's dedupe key came from, and which webhook secret verified it.
-- Closed value sets kept as text rather than enums: they are recording
-- details of the webhook path, not domain concepts.
ALTER TABLE "public"."billing_event"
  ADD CONSTRAINT "billing_event_dedupeSource_check"
  CHECK ("dedupeSource" IN ('HEADER', 'BODY_SHA256'));

ALTER TABLE "public"."billing_event"
  ADD CONSTRAINT "billing_event_matchedSecret_check"
  CHECK ("matchedSecret" IN ('CURRENT', 'PREVIOUS'));
