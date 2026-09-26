-- Adds the anomaly raised when a TRIAL subscription is still `authenticated`
-- past its `start_at` plus the trial-conversion grace (C7): it stops
-- contributing access and an operator is asked to look (Phase VII, IB-9).
-- Until now Phase IV emitted only the alert, because the enum value waited for
-- this phase.
--
-- In its own migration, as the repository's convention requires: Prisma
-- Migrate wraps each migration in a transaction, and Postgres restricts using
-- an enum value in the transaction that added it.
--
-- Purely additive: no existing value is renamed, reordered or removed.

ALTER TYPE "public"."BillingAnomalyType" ADD VALUE 'TRIAL_CONVERSION_OVERDUE';
