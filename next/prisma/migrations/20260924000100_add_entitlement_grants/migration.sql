-- CreateEnum
CREATE TYPE "public"."MembershipPlan" AS ENUM ('PRO', 'PRO_PLUS');

-- CreateEnum
CREATE TYPE "public"."EntitlementSource" AS ENUM ('ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "public"."GrantStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."GrantAuditAction" AS ENUM ('CREATED', 'EXTENDED', 'REVOKED');

-- CreateTable
CREATE TABLE "public"."entitlement_grant" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "subjectPseudonym" TEXT,
    "plan" "public"."MembershipPlan" NOT NULL,
    "source" "public"."EntitlementSource" NOT NULL,
    "status" "public"."GrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "grantedByUserId" TEXT,
    "reason" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entitlement_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."grant_audit_entry" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "action" "public"."GrantAuditAction" NOT NULL,
    "performedByUserId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "subjectPseudonym" TEXT,
    "plan" "public"."MembershipPlan" NOT NULL,
    "previousValidUntil" TIMESTAMP(3),
    "newValidUntil" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grant_audit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entitlement_grant_userId_status_validUntil_idx" ON "public"."entitlement_grant"("userId", "status", "validUntil");

-- CreateIndex
CREATE INDEX "grant_audit_entry_grantId_createdAt_idx" ON "public"."grant_audit_entry"("grantId", "createdAt");

-- CreateIndex
CREATE INDEX "grant_audit_entry_targetUserId_createdAt_idx" ON "public"."grant_audit_entry"("targetUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."entitlement_grant" ADD CONSTRAINT "entitlement_grant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."grant_audit_entry" ADD CONSTRAINT "grant_audit_entry_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "public"."entitlement_grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."grant_audit_entry" ADD CONSTRAINT "grant_audit_entry_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CustomCheck
-- A grant's validity window is either open-ended or ends after it starts.
-- The service validates this on every write path; the constraint stops a
-- future write path that forgets, which would otherwise produce a grant that
-- can never contribute and looks valid in listings.
ALTER TABLE "public"."entitlement_grant"
  ADD CONSTRAINT "entitlement_grant_validity_window_check"
  CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");

-- CustomCheck
-- An administrator can never grant access to themselves (SB-EA-08). The
-- service refuses first with SELF_GRANT_FORBIDDEN; this is defense in depth,
-- because a self-grant is the simplest privilege escalation in an admin tool.
-- Once a future pseudonymization nulls "userId", the comparison is NULL and
-- the row stays valid — which is correct: the history was valid when written.
ALTER TABLE "public"."entitlement_grant"
  ADD CONSTRAINT "entitlement_grant_no_self_grant_check"
  CHECK ("source" <> 'ADMIN_GRANT' OR ("grantedByUserId" IS NOT NULL AND "grantedByUserId" <> "userId"));

-- CustomCheck
-- A revoked grant always records when it was revoked, and only a revoked
-- grant does. Keeps "status" and "revokedAt" from drifting apart.
ALTER TABLE "public"."entitlement_grant"
  ADD CONSTRAINT "entitlement_grant_revocation_consistency_check"
  CHECK (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL));

-- CustomCheck
-- Every grant and every audit entry carries a reason (SB-EA-08: "a mandatory
-- reason"). An empty string would satisfy NOT NULL while recording nothing.
ALTER TABLE "public"."entitlement_grant"
  ADD CONSTRAINT "entitlement_grant_reason_not_blank_check"
  CHECK (length(btrim("reason")) > 0);

ALTER TABLE "public"."grant_audit_entry"
  ADD CONSTRAINT "grant_audit_entry_reason_not_blank_check"
  CHECK (length(btrim("reason")) > 0);
