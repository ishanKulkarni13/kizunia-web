/*
  Warnings:

  - Made the column `suggestionTitle` on table `competition_suggestion` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "public"."competition_suggestion" ALTER COLUMN "suggestionTitle" SET NOT NULL;
