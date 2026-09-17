-- CreateEnum
CREATE TYPE "public"."NotificationIntent" AS ENUM ('TOP_RELEVANT_COMPETITION');

-- CreateEnum
CREATE TYPE "public"."CompetitionPreferenceDimension" AS ENUM ('mode', 'categories', 'technologies', 'eligibilities', 'location', 'registrationPlatform', 'registrationType', 'registrationFeeType', 'organizerType', 'difficulty', 'certificateType', 'status', 'teamSize');

-- DropIndex
DROP INDEX "public"."notification_preference_userId_key";

-- AlterTable
-- Replaces the legacy, unused NotificationPreference shape
-- (emailNotifications / pushNotifications / untyped preferences Json) with
-- a per-intent row. Confirmed safe: no code path in the app ever wrote to
-- this table (see docs/architecture/notifications/persistence/preference-storage.md),
-- so there is no data to migrate forward from the dropped columns.
ALTER TABLE "public"."notification_preference" DROP COLUMN "emailNotifications",
DROP COLUMN "preferences",
DROP COLUMN "pushNotifications",
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "intent" "public"."NotificationIntent" NOT NULL;

-- CreateTable
CREATE TABLE "public"."competition_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dimension" "public"."CompetitionPreferenceDimension" NOT NULL,
    "value" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competition_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competition_preference_userId_idx" ON "public"."competition_preference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "competition_preference_userId_dimension_value_key" ON "public"."competition_preference"("userId", "dimension", "value");

-- CreateIndex
CREATE INDEX "notification_preference_userId_idx" ON "public"."notification_preference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_userId_intent_key" ON "public"."notification_preference"("userId", "intent");

-- AddForeignKey
ALTER TABLE "public"."competition_preference" ADD CONSTRAINT "competition_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint
-- Prisma has no native schema attribute for a numeric range check, so this
-- is added by hand: weight semantics (0 = no preference / not stored, 0-1
-- soft, 1 hard constraint) are a domain invariant the database should
-- enforce directly, not only the application layer. See
-- docs/project/feature-specification/notification/preferences/weights-and-constraints.md.
ALTER TABLE "public"."competition_preference" ADD CONSTRAINT "competition_preference_weight_check" CHECK ("weight" >= 0 AND "weight" <= 1);
