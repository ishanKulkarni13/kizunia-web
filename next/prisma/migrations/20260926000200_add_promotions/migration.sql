-- Promotions (Phase VII, SB-CP-01/04): free plan-level access redeemed with a
-- code. A Kizunia-only record; redemption creates an EntitlementGrant with
-- source PROMOTION in the same transaction. See
-- docs/architecture/subscription/entitlements/coupons-and-offers.md.

-- CreateEnum
CREATE TYPE "public"."CodeEligibility" AS ENUM ('ANY_USER', 'FIRST_PAID_SUBSCRIPTION_ONLY', 'ONCE_PER_USER');

-- AlterTable
ALTER TABLE "public"."entitlement_grant" ADD COLUMN "promotionId" TEXT;

-- AlterTable
ALTER TABLE "public"."grant_audit_entry" ADD COLUMN "promotionId" TEXT;

-- CreateTable
CREATE TABLE "public"."promotion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "plan" "public"."MembershipPlan" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "remainingRedemptions" INTEGER,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "eligibility" "public"."CodeEligibility" NOT NULL DEFAULT 'ANY_USER',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."promotion_redemption" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "userId" TEXT,
    "subjectPseudonym" TEXT,
    "grantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotion_code_key" ON "public"."promotion"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemption_grantId_key" ON "public"."promotion_redemption"("grantId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemption_promotionId_userId_key" ON "public"."promotion_redemption"("promotionId", "userId");

-- AddForeignKey
ALTER TABLE "public"."entitlement_grant" ADD CONSTRAINT "entitlement_grant_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "public"."promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."grant_audit_entry" ADD CONSTRAINT "grant_audit_entry_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "public"."promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotion_redemption" ADD CONSTRAINT "promotion_redemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "public"."promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotion_redemption" ADD CONSTRAINT "promotion_redemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotion_redemption" ADD CONSTRAINT "promotion_redemption_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "public"."entitlement_grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CustomCheck
-- The remaining-redemptions counter never goes negative. The redeem path
-- decrements conditionally (WHERE remainingRedemptions > 0); this stops a
-- future write path that forgets, which would otherwise oversell a promotion.
-- NULL means unlimited.
ALTER TABLE "public"."promotion"
  ADD CONSTRAINT "promotion_remaining_redemptions_check"
  CHECK ("remainingRedemptions" IS NULL OR "remainingRedemptions" >= 0);

-- CustomCheck
-- A promotion grants access for a positive number of days, and its
-- redemption window is either open-ended or ends after it starts.
ALTER TABLE "public"."promotion"
  ADD CONSTRAINT "promotion_duration_check"
  CHECK ("durationDays" > 0);

ALTER TABLE "public"."promotion"
  ADD CONSTRAINT "promotion_validity_window_check"
  CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");

-- CustomCheck
-- A code is stored normalized (trimmed, upper-case), so uniqueness of the
-- column is uniqueness of the code case-insensitively.
ALTER TABLE "public"."promotion"
  ADD CONSTRAINT "promotion_code_normalized_check"
  CHECK ("code" = upper(btrim("code")) AND length("code") > 0);

-- CustomCheck
-- A PROMOTION grant always names its promotion, so it can be traced and
-- audited; an admin grant never does. (grantedByUserId stays NULL for a
-- promotion: the redeemer is the actor, recorded on the audit entry.)
ALTER TABLE "public"."entitlement_grant"
  ADD CONSTRAINT "entitlement_grant_promotion_source_check"
  CHECK (("source" <> 'PROMOTION' OR "promotionId" IS NOT NULL) AND ("source" <> 'ADMIN_GRANT' OR "promotionId" IS NULL));
