-- AlterTable
ALTER TABLE "public"."competition" ADD COLUMN     "automaticStatusUpdatesDisabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationStartDate" TIMESTAMP(3),
ADD COLUMN     "statusUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "competition_registrationStartDate_idx" ON "public"."competition"("registrationStartDate");
