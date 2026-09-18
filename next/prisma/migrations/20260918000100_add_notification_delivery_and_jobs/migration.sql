-- Notification delivery infrastructure.
--
-- Adds the record/target/delivery/attempt model, push subscriptions, the
-- durable job queue, feature announcements, and the internal-task run marker.
-- See docs/architecture/notifications/IMPLEMENTATION-STATUS.md.
--
-- Entirely additive: no existing table or column is altered or dropped.

-- CreateEnum
CREATE TYPE "public"."NotificationTargetType" AS ENUM ('COMPETITION', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('IN_APP', 'WEB_PUSH');

-- CreateEnum
CREATE TYPE "public"."NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."NotificationDeliveryOutcome" AS ENUM ('ACCEPTED', 'INVALID_TOKEN', 'RETRYABLE', 'PERMANENT');

-- CreateEnum
CREATE TYPE "public"."PushProviderId" AS ENUM ('FCM');

-- CreateEnum
CREATE TYPE "public"."PushSubscriptionStatus" AS ENUM ('ACTIVE', 'INVALID', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."NotificationJobKind" AS ENUM ('EVALUATE_TOP_RELEVANT_COMPETITION', 'EVALUATE_REGISTRATION_CLOSING', 'FANOUT_ANNOUNCEMENT', 'DELIVER_NOTIFICATION');

-- CreateEnum
CREATE TYPE "public"."NotificationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."FeatureAnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intent" "public"."NotificationIntent" NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionPath" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_target" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "public"."NotificationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetVersion" TEXT,
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_delivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "status" "public"."NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "provider" "public"."PushProviderId",
    "providerMessageId" TEXT,
    "pushSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_delivery_attempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" "public"."NotificationDeliveryOutcome",
    "errorCode" TEXT,
    "providerResponse" JSONB,

    CONSTRAINT "notification_delivery_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."push_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."PushProviderId" NOT NULL DEFAULT 'FCM',
    "token" TEXT NOT NULL,
    "userAgent" TEXT,
    "status" "public"."PushSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_job" (
    "id" TEXT NOT NULL,
    "kind" "public"."NotificationJobKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "public"."NotificationJobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "notification_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."feature_announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "createdById" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "public"."FeatureAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."internal_job_run" (
    "taskId" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_job_run_pkey" PRIMARY KEY ("taskId")
);

-- CreateIndex
CREATE INDEX "notification_userId_createdAt_idx" ON "public"."notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notification_userId_readAt_idx" ON "public"."notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_userId_intent_occurrenceKey_key" ON "public"."notification"("userId", "intent", "occurrenceKey");

-- CreateIndex
CREATE INDEX "notification_target_userId_targetType_targetId_targetVersio_idx" ON "public"."notification_target"("userId", "targetType", "targetId", "targetVersion");

-- CreateIndex
CREATE INDEX "notification_target_targetType_targetId_idx" ON "public"."notification_target"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_target_notificationId_targetType_targetId_key" ON "public"."notification_target"("notificationId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "notification_delivery_status_nextAttemptAt_idx" ON "public"."notification_delivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notification_delivery_notificationId_idx" ON "public"."notification_delivery"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_notificationId_channel_pushSubscripti_key" ON "public"."notification_delivery"("notificationId", "channel", "pushSubscriptionId");

-- CreateIndex
CREATE INDEX "notification_delivery_attempt_deliveryId_idx" ON "public"."notification_delivery_attempt"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_attempt_deliveryId_attemptNumber_key" ON "public"."notification_delivery_attempt"("deliveryId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_token_key" ON "public"."push_subscription"("token");

-- CreateIndex
CREATE INDEX "push_subscription_userId_status_idx" ON "public"."push_subscription"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_job_dedupeKey_key" ON "public"."notification_job"("dedupeKey");

-- CreateIndex
CREATE INDEX "notification_job_status_runAt_idx" ON "public"."notification_job"("status", "runAt");

-- CreateIndex
CREATE INDEX "notification_job_status_completedAt_idx" ON "public"."notification_job"("status", "completedAt");

-- CreateIndex
CREATE INDEX "feature_announcement_status_scheduledFor_idx" ON "public"."feature_announcement"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "public"."notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_target" ADD CONSTRAINT "notification_target_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "public"."notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_delivery" ADD CONSTRAINT "notification_delivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "public"."notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_delivery" ADD CONSTRAINT "notification_delivery_pushSubscriptionId_fkey" FOREIGN KEY ("pushSubscriptionId") REFERENCES "public"."push_subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_delivery_attempt" ADD CONSTRAINT "notification_delivery_attempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "public"."notification_delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."push_subscription" ADD CONSTRAINT "push_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."feature_announcement" ADD CONSTRAINT "feature_announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CustomIndex
-- Postgres treats NULLs as DISTINCT in a unique index, so the three-column
-- unique constraint above does not constrain in-app deliveries at all: their
-- "pushSubscriptionId" is NULL, and every NULL differs from every other. One
-- notification could therefore accumulate unlimited in-app delivery rows.
--
-- This partial unique index closes that. Prisma has no attribute for a partial
-- index, so it is written by hand here — the same precedent as the weight
-- CHECK in 20260917000000_replace_notification_preference_and_add_competition_preference.
--
-- Because the Prisma client does not know this index exists, in-app delivery
-- rows must be created and the resulting P2002 caught. They must never be
-- upserted: Prisma can only upsert on a constraint it knows about.
CREATE UNIQUE INDEX "notification_delivery_notificationId_channel_null_push_key"
  ON "public"."notification_delivery" ("notificationId", "channel")
  WHERE "pushSubscriptionId" IS NULL;

-- CustomCheck
-- A notification's action is a path inside Kizunia, never an absolute URL.
--
-- Validation already enforces this on the write path. The constraint exists
-- because the cost of a future write path forgetting it is an open redirect
-- delivered by the platform's own notification system, which is a considerably
-- worse failure than a rejected insert.
--
-- Rejects: "https://evil.example", "//evil.example" (protocol-relative) and
-- "/\evil.example" (which some browsers normalise to a host).
ALTER TABLE "public"."notification"
  ADD CONSTRAINT "notification_actionPath_relative_check"
  CHECK ("actionPath" IS NULL OR "actionPath" ~ '^/[^/\\]');
