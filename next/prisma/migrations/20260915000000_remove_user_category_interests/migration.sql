-- Phase 0 recommendation engine: user category "interests" are removed from
-- the domain model. Preference profiles for recommendations come from the
-- recommendations module (see docs/architecture/recommendation/), not from
-- this table.
-- DropForeignKey
ALTER TABLE "public"."user_category" DROP CONSTRAINT IF EXISTS "user_category_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_category" DROP CONSTRAINT IF EXISTS "user_category_categoryId_fkey";

-- DropTable
DROP TABLE IF EXISTS "public"."user_category";
