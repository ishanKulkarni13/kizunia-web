-- Safety: remap any existing UNLISTED portfolios to PRIVATE before the
-- enum value is dropped. PRIVATE is the conservative choice: it strictly
-- narrows visibility (removes public reachability) rather than widening
-- it, so no portfolio the owner had kept out of full public discovery
-- becomes more exposed than before. No known rows use UNLISTED today
-- (no migration, seed, or application code path ever sets it), but this
-- makes the migration safe even if some do.
UPDATE "portfolio" SET "visibility" = 'PRIVATE' WHERE "visibility" = 'UNLISTED';

-- Postgres cannot drop a single enum value in place, so the type is
-- recreated without it and swapped in.
CREATE TYPE "PortfolioVisibility_new" AS ENUM ('PUBLIC', 'PRIVATE');
ALTER TABLE "portfolio" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "portfolio" ALTER COLUMN "visibility" TYPE "PortfolioVisibility_new" USING ("visibility"::text::"PortfolioVisibility_new");
ALTER TYPE "PortfolioVisibility" RENAME TO "PortfolioVisibility_old";
ALTER TYPE "PortfolioVisibility_new" RENAME TO "PortfolioVisibility";
ALTER TABLE "portfolio" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';
DROP TYPE "PortfolioVisibility_old";
