-- AlterEnum
-- Adds domain-specific testimonial image purposes. The old "TESTIMONIAL_IMAGE"
-- value is left in place (Postgres cannot safely drop enum values) but is no
-- longer issued by application code.
ALTER TYPE "public"."AssetPurpose" ADD VALUE 'PROJECT_TESTIMONIAL_IMAGE';
ALTER TYPE "public"."AssetPurpose" ADD VALUE 'PORTFOLIO_TESTIMONIAL_IMAGE';

-- CreateIndex
CREATE INDEX "testimonial_projectId_idx" ON "public"."testimonial"("projectId");

-- CreateIndex
CREATE INDEX "testimonial_portfolioId_idx" ON "public"."testimonial"("portfolioId");

-- CreateIndex
CREATE INDEX "testimonial_imageAssetId_idx" ON "public"."testimonial"("imageAssetId");
