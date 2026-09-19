-- AlterEnum
-- Technology gets its own Asset-backed icon purpose, following the existing
-- BADGE_ICON precedent (a global, non-per-instance-owned entity).
ALTER TYPE "public"."AssetPurpose" ADD VALUE 'TECHNOLOGY_ICON';

-- CreateEnum
-- Describes WHAT a Technology is. Consumer-specific meaning (used vs.
-- relevant vs. presented) is never encoded here — see
-- docs/architecture/domain/technology.md.
CREATE TYPE "public"."TechnologyType" AS ENUM ('LANGUAGE', 'FRAMEWORK', 'LIBRARY', 'DATABASE', 'RUNTIME', 'TOOL', 'PLATFORM', 'SERVICE', 'OTHER');

-- AlterTable
-- Technology becomes a full taxonomy entity: typed, Asset-backed icon
-- (replacing the plain iconUrl string), timestamped, and soft-deletable.
-- No production-data compatibility requirement exists for iconUrl, so it is
-- dropped directly rather than shimmed.
ALTER TABLE "public"."technology"
  ADD COLUMN "type" "public"."TechnologyType" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "iconAssetId" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  DROP COLUMN "iconUrl";

-- CreateIndex
CREATE INDEX "technology_deletedAt_idx" ON "public"."technology"("deletedAt");

-- AddForeignKey
ALTER TABLE "public"."technology" ADD CONSTRAINT "technology_iconAssetId_fkey" FOREIGN KEY ("iconAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- Adds explicit ordering to ProjectTechnology (locked decision: Project and
-- Portfolio technologies are ordered, Competition technologies are not).
ALTER TABLE "public"."project_technology" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "project_technology_projectId_displayOrder_idx" ON "public"."project_technology"("projectId", "displayOrder");

-- DropForeignKey
ALTER TABLE "public"."user_technology" DROP CONSTRAINT "user_technology_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_technology" DROP CONSTRAINT "user_technology_technologyId_fkey";

-- DropTable
-- UserTechnology is retired: Technology is no longer a direct User profile
-- relationship. PortfolioTechnology is the presentation-oriented
-- replacement.
DROP TABLE "public"."user_technology";
