-- Admin notification for new competition suggestions.
--
-- Three enum extensions and nothing else. They are in their own migration for
-- the same reason `20260918000000_extend_notification_intent` was: Prisma wraps
-- a migration in one transaction, and Postgres refuses to *use* a value added
-- by `ALTER TYPE ... ADD VALUE` inside the transaction that added it. Keeping
-- the additions alone means no later statement can accidentally reference one.
--
-- Purely additive. No table, column, index or constraint changes, so nothing
-- existing can be invalidated by applying this.

-- AlterEnum
ALTER TYPE "public"."NotificationIntent" ADD VALUE 'ADMIN_COMPETITION_SUGGESTION';

-- AlterEnum
ALTER TYPE "public"."NotificationTargetType" ADD VALUE 'COMPETITION_SUGGESTION';

-- AlterEnum
ALTER TYPE "public"."NotificationJobKind" ADD VALUE 'NOTIFY_ADMINS_OF_SUGGESTION';
