-- Adds the two notification intents that the delivery work implements:
-- REGISTRATION_CLOSING (ND-I-19, ND-I-20) and FEATURE_ANNOUNCEMENT (ND-I-21).
--
-- These live in their own migration, separate from the tables that use them,
-- on purpose. Prisma Migrate wraps each migration in a transaction, and
-- Postgres restricts using an enum value in the same transaction that added
-- it. Splitting removes the constraint entirely rather than relying on a
-- specific server version tolerating it.
--
-- Purely additive: no existing value is renamed, reordered or removed, so no
-- stored row changes meaning.

ALTER TYPE "public"."NotificationIntent" ADD VALUE 'REGISTRATION_CLOSING';
ALTER TYPE "public"."NotificationIntent" ADD VALUE 'FEATURE_ANNOUNCEMENT';
