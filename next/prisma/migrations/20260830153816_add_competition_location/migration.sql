-- CreateEnum
CREATE TYPE "public"."LocationPrecision" AS ENUM ('UNKNOWN', 'COUNTRY', 'STATE', 'CITY', 'VENUE');

-- CreateEnum
CREATE TYPE "public"."LocationProvider" AS ENUM ('MANUAL', 'NOMINATIM');

-- AlterTable
ALTER TABLE "public"."competition" DROP COLUMN "location";

-- CreateTable
CREATE TABLE "public"."location" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "precision" "public"."LocationPrecision" NOT NULL DEFAULT 'UNKNOWN',
    "country" TEXT,
    "countryCode" VARCHAR(2),
    "state" TEXT,
    "stateCode" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "timezone" TEXT,
    "provider" "public"."LocationProvider" NOT NULL DEFAULT 'MANUAL',
    "providerLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."competition_location" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "label" TEXT,
    "venueName" TEXT,
    "address" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competition_location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "location_countryCode_idx" ON "public"."location"("countryCode");

-- CreateIndex
CREATE INDEX "location_city_idx" ON "public"."location"("city");

-- CreateIndex
CREATE INDEX "location_state_idx" ON "public"."location"("state");

-- CreateIndex
CREATE INDEX "location_provider_providerLocationId_idx" ON "public"."location"("provider", "providerLocationId");

-- CreateIndex
CREATE INDEX "competition_location_competitionId_order_idx" ON "public"."competition_location"("competitionId", "order");

-- CreateIndex
CREATE INDEX "competition_location_locationId_idx" ON "public"."competition_location"("locationId");

-- AddForeignKey
ALTER TABLE "public"."competition_location" ADD CONSTRAINT "competition_location_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_location" ADD CONSTRAINT "competition_location_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

