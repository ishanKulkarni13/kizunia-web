/*
  Warnings:

  - You are about to drop the column `iconUrl` on the `badge` table. All the data in the column will be lost.
  - You are about to drop the column `bio` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `college` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `degree` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `graduationYear` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `headline` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `user` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."PortfolioVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- AlterTable
ALTER TABLE "public"."badge" DROP COLUMN "iconUrl",
ADD COLUMN     "iconAssetId" TEXT;

-- AlterTable
ALTER TABLE "public"."link" ADD COLUMN     "portfolioId" TEXT;

-- AlterTable
ALTER TABLE "public"."project" ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "startDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."user" DROP COLUMN "bio",
DROP COLUMN "college",
DROP COLUMN "degree",
DROP COLUMN "graduationYear",
DROP COLUMN "headline",
DROP COLUMN "location";

-- CreateTable
CREATE TABLE "public"."portfolio_project" (
    "portfolioId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_project_pkey" PRIMARY KEY ("portfolioId","projectId")
);

-- CreateTable
CREATE TABLE "public"."portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headline" TEXT,
    "about" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "publicContactEmail" TEXT,
    "website" TEXT,
    "location" TEXT,
    "visibility" "public"."PortfolioVisibility" NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "resumeAssetId" TEXT,

    CONSTRAINT "portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."portfolio_settings" (
    "id" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'default',
    "accentColor" TEXT NOT NULL DEFAULT 'blue',
    "sectionOrder" JSONB,
    "hiddenSections" JSONB,
    "timelineConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "portfolioId" TEXT NOT NULL,

    CONSTRAINT "portfolio_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."portfolio_technology" (
    "portfolioId" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,
    "startedUsingAt" TIMESTAMP(3),
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "portfolio_technology_pkey" PRIMARY KEY ("portfolioId","technologyId")
);

-- CreateTable
CREATE TABLE "public"."portfolio_education" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "degree" TEXT,
    "fieldOfStudy" TEXT,
    "grade" TEXT,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "currentlyStudying" BOOLEAN NOT NULL DEFAULT false,
    "institutionLogoAssetId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."portfolio_experience" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "employmentType" TEXT,
    "location" TEXT,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "currentlyWorking" BOOLEAN NOT NULL DEFAULT false,
    "companyLogoAssetId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."portfolio_achievement" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "achievedAt" TIMESTAMP(3),
    "assetId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."portfolio_certification" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "credentialId" TEXT,
    "credentialUrl" TEXT,
    "assetId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."testimonial" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "company" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 100,
    "message" TEXT NOT NULL,
    "rating" INTEGER,
    "imageAssetId" TEXT,
    "portfolioId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_project_portfolioId_displayOrder_idx" ON "public"."portfolio_project"("portfolioId", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_userId_key" ON "public"."portfolio"("userId");

-- CreateIndex
CREATE INDEX "portfolio_visibility_idx" ON "public"."portfolio"("visibility");

-- CreateIndex
CREATE INDEX "portfolio_deletedAt_idx" ON "public"."portfolio"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_settings_portfolioId_key" ON "public"."portfolio_settings"("portfolioId");

-- CreateIndex
CREATE INDEX "link_portfolioId_idx" ON "public"."link"("portfolioId");

-- AddForeignKey
ALTER TABLE "public"."link" ADD CONSTRAINT "link_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."badge" ADD CONSTRAINT "badge_iconAssetId_fkey" FOREIGN KEY ("iconAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_project" ADD CONSTRAINT "portfolio_project_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_project" ADD CONSTRAINT "portfolio_project_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio" ADD CONSTRAINT "portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio" ADD CONSTRAINT "portfolio_resumeAssetId_fkey" FOREIGN KEY ("resumeAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_settings" ADD CONSTRAINT "portfolio_settings_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_technology" ADD CONSTRAINT "portfolio_technology_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_technology" ADD CONSTRAINT "portfolio_technology_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "public"."technology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_education" ADD CONSTRAINT "portfolio_education_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_education" ADD CONSTRAINT "portfolio_education_institutionLogoAssetId_fkey" FOREIGN KEY ("institutionLogoAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_experience" ADD CONSTRAINT "portfolio_experience_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_experience" ADD CONSTRAINT "portfolio_experience_companyLogoAssetId_fkey" FOREIGN KEY ("companyLogoAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_achievement" ADD CONSTRAINT "portfolio_achievement_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_achievement" ADD CONSTRAINT "portfolio_achievement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_certification" ADD CONSTRAINT "portfolio_certification_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."portfolio_certification" ADD CONSTRAINT "portfolio_certification_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."testimonial" ADD CONSTRAINT "testimonial_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."testimonial" ADD CONSTRAINT "testimonial_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."testimonial" ADD CONSTRAINT "testimonial_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
