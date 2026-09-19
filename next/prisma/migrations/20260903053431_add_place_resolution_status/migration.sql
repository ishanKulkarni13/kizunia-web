-- CreateEnum
CREATE TYPE "public"."PlaceResolutionStatus" AS ENUM ('RESOLVED', 'NOT_FOUND');

-- AlterTable
ALTER TABLE "public"."place_resolution" ADD COLUMN     "status" "public"."PlaceResolutionStatus" NOT NULL DEFAULT 'RESOLVED';
