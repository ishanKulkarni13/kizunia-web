/*
  Warnings:

  - You are about to drop the column `about` on the `portfolio` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `portfolio` table. All the data in the column will be lost.
  - You are about to drop the column `website` on the `portfolio` table. All the data in the column will be lost.
  - You are about to drop the column `timelineConfig` on the `portfolio_settings` table. All the data in the column will be lost.
  - The `sectionOrder` column on the `portfolio_settings` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `hiddenSections` column on the `portfolio_settings` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `displayName` to the `portfolio` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."portfolio" DROP COLUMN "about",
DROP COLUMN "email",
DROP COLUMN "website",
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "displayName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."portfolio_settings" DROP COLUMN "timelineConfig",
DROP COLUMN "sectionOrder",
ADD COLUMN     "sectionOrder" TEXT[],
DROP COLUMN "hiddenSections",
ADD COLUMN     "hiddenSections" TEXT[];

-- CreateIndex
CREATE INDEX "portfolio_userId_idx" ON "public"."portfolio"("userId");

-- CreateIndex
CREATE INDEX "project_slug_idx" ON "public"."project"("slug");

-- CreateIndex
CREATE INDEX "project_status_idx" ON "public"."project"("status");

-- CreateIndex
CREATE INDEX "project_visibility_idx" ON "public"."project"("visibility");

-- CreateIndex
CREATE INDEX "project_deletedAt_idx" ON "public"."project"("deletedAt");

-- CreateIndex
CREATE INDEX "project_createdById_idx" ON "public"."project"("createdById");

-- CreateIndex
CREATE INDEX "project_updatedById_idx" ON "public"."project"("updatedById");
