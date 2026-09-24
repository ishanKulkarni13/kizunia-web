-- New Portfolios are created PRIVATE: the owner publishes deliberately.
-- Only the column default changes. Existing rows keep their stored value —
-- no backfill — so no portfolio is silently published or unpublished.
ALTER TABLE "public"."portfolio" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';

-- "portfolio"."userId" is already @unique, so this non-unique index on the
-- same column is redundant.
DROP INDEX "public"."portfolio_userId_idx";
