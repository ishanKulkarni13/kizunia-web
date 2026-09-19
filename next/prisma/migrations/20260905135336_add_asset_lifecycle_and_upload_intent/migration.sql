-- CreateEnum
CREATE TYPE "public"."AssetStatus" AS ENUM ('ACTIVE', 'DETACHED', 'DELETING', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."AssetCategory" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "public"."UploadIntentStatus" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."AssetPurpose" AS ENUM ('USER_AVATAR', 'USER_COVER', 'PROJECT_LOGO', 'PROJECT_COVER', 'COMPETITION_LOGO', 'COMPETITION_BANNER', 'COMPETITION_COVER', 'COMPETITION_SUGGESTION_GALLERY', 'PORTFOLIO_RESUME', 'PORTFOLIO_EDUCATION_LOGO', 'PORTFOLIO_EXPERIENCE_LOGO', 'PORTFOLIO_ACHIEVEMENT_ASSET', 'PORTFOLIO_CERTIFICATION_ASSET', 'TESTIMONIAL_IMAGE', 'BADGE_ICON');

-- AlterTable
ALTER TABLE "public"."asset" ADD COLUMN     "category" "public"."AssetCategory" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "detachedAt" TIMESTAMP(3),
ADD COLUMN     "status" "public"."AssetStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "uploadedById" TEXT;

-- CreateTable
CREATE TABLE "public"."upload_intent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "purpose" "public"."AssetPurpose" NOT NULL,
    "category" "public"."AssetCategory" NOT NULL,
    "targetEntityType" TEXT,
    "targetEntityId" TEXT,
    "providerCorrelationId" TEXT NOT NULL,
    "declaredMimeType" TEXT NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "status" "public"."UploadIntentStatus" NOT NULL DEFAULT 'PENDING',
    "resultAssetId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_intent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upload_intent_providerCorrelationId_key" ON "public"."upload_intent"("providerCorrelationId");

-- CreateIndex
CREATE INDEX "upload_intent_actorId_status_idx" ON "public"."upload_intent"("actorId", "status");

-- CreateIndex
CREATE INDEX "upload_intent_expiresAt_idx" ON "public"."upload_intent"("expiresAt");

-- CreateIndex
CREATE INDEX "asset_status_idx" ON "public"."asset"("status");

-- CreateIndex
CREATE INDEX "asset_status_detachedAt_idx" ON "public"."asset"("status", "detachedAt");

-- CreateIndex
CREATE INDEX "asset_uploadedById_idx" ON "public"."asset"("uploadedById");

-- AddForeignKey
ALTER TABLE "public"."asset" ADD CONSTRAINT "asset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."upload_intent" ADD CONSTRAINT "upload_intent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
