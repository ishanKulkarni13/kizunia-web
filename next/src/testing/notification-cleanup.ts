/**
 * Shared cleanup for notification integration tests.
 *
 * Exists because the usual prefix trick does not reach everything here. Test
 * data is namespaced by a prefix on the user's email, and most rows are
 * reachable from the user — but a delivery job's dedupe key is built from the
 * *notification's* id, which is a cuid with no prefix in it. Those rows survive
 * a prefix-scoped delete, accumulate across files, and then show up inside
 * another file's `claim()`, which is global by nature.
 *
 * The symptom is a test asserting "one job was processed" and getting
 * twenty-six. The cause is invisible from the failing file.
 */
import prisma from "@/lib/prisma";

import { deleteGrantsForUsers } from "./entitlement-fixtures";

/**
 * Deletes every row belonging to users whose email starts with `prefix`,
 * including the job rows that only reference them indirectly.
 *
 * Order matters: notification ids have to be read before the users are deleted,
 * because deleting the user cascades the notifications away and takes the only
 * link to their jobs with it.
 */
export async function cleanupNotificationTestData(prefix: string): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  });

  const userIds = users.map((user) => user.id);

  const notifications = userIds.length
    ? await prisma.notification.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      })
    : [];

  await prisma.notificationJob.deleteMany({
    where: {
      OR: [
        { dedupeKey: { contains: prefix } },
        ...notifications.map((notification) => ({
          dedupeKey: { contains: notification.id },
        })),
      ],
    },
  });

  // Grants restrict user deletion (`onDelete: Restrict`), so they go first.
  await deleteGrantsForUsers(userIds);

  // Cascades to notifications, targets, deliveries, attempts and push
  // subscriptions.
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}
