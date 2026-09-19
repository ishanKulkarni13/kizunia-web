/*
  Warnings:

  - You are about to drop the column `documentation` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `endDate` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `maxTeamSize` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `minTeamSize` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `mode` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `organizer` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `prizePool` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `registrationDeadline` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `registrationLink` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `shortDescription` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `startDate` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `competition_suggestion` table. All the data in the column will be lost.
  - You are about to drop the column `website` on the `competition_suggestion` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."competition_suggestion" DROP COLUMN "documentation",
DROP COLUMN "endDate",
DROP COLUMN "location",
DROP COLUMN "maxTeamSize",
DROP COLUMN "minTeamSize",
DROP COLUMN "mode",
DROP COLUMN "organizer",
DROP COLUMN "prizePool",
DROP COLUMN "registrationDeadline",
DROP COLUMN "registrationLink",
DROP COLUMN "shortDescription",
DROP COLUMN "startDate",
DROP COLUMN "title",
DROP COLUMN "website";
