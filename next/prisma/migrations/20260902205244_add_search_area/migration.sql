-- CreateEnum
CREATE TYPE "public"."SearchAreaRelation" AS ENUM ('EXACT', 'WITHIN');

-- CreateEnum
CREATE TYPE "public"."SearchAreaSource" AS ENUM ('SELECTED_PLACE', 'CONTAINING_PLACE', 'ADDRESS_DESCRIPTOR', 'ADDRESS_COMPONENT');

-- AlterEnum
-- LocationProvider: NOMINATIM is dropped in favour of GOOGLE. Any location
-- already ingested through Nominatim is re-labelled MANUAL: its stored fields
-- remain valid, they simply no longer trace to a supported provider.
--
-- The enum swap must run before search_area is created, since that table's
-- provider column is typed on the new enum.
BEGIN;
UPDATE "public"."location" SET "provider" = 'MANUAL' WHERE "provider" = 'NOMINATIM';
CREATE TYPE "public"."LocationProvider_new" AS ENUM ('MANUAL', 'GOOGLE');
ALTER TABLE "public"."location" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "public"."location" ALTER COLUMN "provider" TYPE "public"."LocationProvider_new" USING ("provider"::text::"public"."LocationProvider_new");
ALTER TYPE "public"."LocationProvider" RENAME TO "LocationProvider_old";
ALTER TYPE "public"."LocationProvider_new" RENAME TO "LocationProvider";
DROP TYPE "public"."LocationProvider_old";
ALTER TABLE "public"."location" ALTER COLUMN "provider" SET DEFAULT 'MANUAL';
COMMIT;

-- CreateTable
CREATE TABLE "public"."search_area" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "providerKind" TEXT,
    "contextLabel" TEXT,
    "provider" "public"."LocationProvider",
    "providerLocationId" TEXT,
    "identityKey" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."location_search_area" (
    "locationId" TEXT NOT NULL,
    "searchAreaId" TEXT NOT NULL,
    "relation" "public"."SearchAreaRelation" NOT NULL,
    "source" "public"."SearchAreaSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_search_area_pkey" PRIMARY KEY ("locationId","searchAreaId")
);

-- CreateIndex
CREATE UNIQUE INDEX "search_area_identityKey_key" ON "public"."search_area"("identityKey");

-- CreateIndex
CREATE INDEX "search_area_displayName_idx" ON "public"."search_area"("displayName");

-- CreateIndex
CREATE INDEX "location_search_area_searchAreaId_idx" ON "public"."location_search_area"("searchAreaId");

-- AddForeignKey
ALTER TABLE "public"."location_search_area" ADD CONSTRAINT "location_search_area_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."location_search_area" ADD CONSTRAINT "location_search_area_searchAreaId_fkey" FOREIGN KEY ("searchAreaId") REFERENCES "public"."search_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
