-- Adds the anomaly raised when Razorpay reports a subscription that Kizunia
-- already holds in a terminal phase (CANCELLED, EXPIRED, COMPLETED, ABANDONED)
-- in any other state. Razorpay documents terminal states as final, so the
-- observation is never applied: it is a mapping or data error for a human
-- (Phase IV, IB-24 item 1).
--
-- In its own migration, as the repository's convention requires: Prisma
-- Migrate wraps each migration in a transaction, and Postgres restricts using
-- an enum value in the transaction that added it.
--
-- Purely additive: no existing value is renamed, reordered or removed.

ALTER TYPE "public"."BillingAnomalyType" ADD VALUE 'TERMINAL_STATE_CONTRADICTED';
