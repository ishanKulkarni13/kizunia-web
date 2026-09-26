-- Adds the entitlement source for a promotion redemption (Phase VII,
-- SB-CP-01/04). A promotion is a Kizunia-only record that creates an ordinary
-- entitlement grant, so the resolver needs no change: it treats every grant
-- the same, whatever its source.
--
-- In its own migration, as the repository's convention requires: Prisma
-- Migrate wraps each migration in a transaction, and Postgres restricts using
-- an enum value in the transaction that added it (the PROMOTION CHECK in
-- 20260926000200_add_promotions uses this value).
--
-- Purely additive: no existing value is renamed, reordered or removed.

ALTER TYPE "public"."EntitlementSource" ADD VALUE 'PROMOTION';
