/*
  Warnings:

  - You are about to drop the column `bannerAssetId` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `coverAssetId` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `logoAssetId` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the `competition_suggestion_category` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `competition_suggestion_technology` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[suggestionContentId]` on the table `competition_suggestion` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "public"."competition_suggestion" DROP CONSTRAINT "competition_suggestion_bannerAssetId_fkey";

-- DropForeignKey
ALTER TABLE "public"."competition_suggestion" DROP CONSTRAINT "competition_suggestion_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."competition_suggestion" DROP CONSTRAINT "competition_suggestion_coverAssetId_fkey";

-- DropForeignKey
ALTER TABLE "public"."competition_suggestion" DROP CONSTRAINT "competition_suggestion_logoAssetId_fkey";

-- DropForeignKey
ALTER TABLE "public"."competition_suggestion_category" DROP CONSTRAINT "competition_suggestion_category_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "public"."competition_suggestion_category" DROP CONSTRAINT "competition_suggestion_category_suggestionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."competition_suggestion_technology" DROP CONSTRAINT "competition_suggestion_technology_suggestionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."competition_suggestion_technology" DROP CONSTRAINT "competition_suggestion_technology_technologyId_fkey";

-- AlterTable
ALTER TABLE "public"."competition_suggestion" DROP COLUMN "bannerAssetId",
DROP COLUMN "coverAssetId",
DROP COLUMN "logoAssetId",
ADD COLUMN     "suggestionContentId" TEXT,
ADD COLUMN     "suggestionTitle" TEXT;

-- DropTable
DROP TABLE "public"."competition_suggestion_category";

-- DropTable
DROP TABLE "public"."competition_suggestion_technology";

-- CreateTable
CREATE TABLE "public"."competition_suggestion_asset" (
    "suggestionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_suggestion_asset_pkey" PRIMARY KEY ("suggestionId","assetId")
);

-- CreateIndex
CREATE INDEX "competition_suggestion_asset_suggestionId_order_idx" ON "public"."competition_suggestion_asset"("suggestionId", "order");

-- CreateIndex
CREATE INDEX "competition_suggestion_asset_assetId_idx" ON "public"."competition_suggestion_asset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "competition_suggestion_suggestionContentId_key" ON "public"."competition_suggestion"("suggestionContentId");

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion" ADD CONSTRAINT "competition_suggestion_suggestionContentId_fkey" FOREIGN KEY ("suggestionContentId") REFERENCES "public"."Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion" ADD CONSTRAINT "competition_suggestion_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion_asset" ADD CONSTRAINT "competition_suggestion_asset_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "public"."competition_suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion_asset" ADD CONSTRAINT "competition_suggestion_asset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
