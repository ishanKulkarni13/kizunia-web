/**
 * Runs one notification tick locally, without the HTTP route or `CRON_SECRET`.
 *
 * `NotificationTickService.run()` is the exact function
 * `GET /api/v1/internal/tick` calls — this script invokes it directly, so
 * behavior is identical to production, just without going over HTTP. Useful
 * for fast local iteration; the developer testing manual
 * (docs/architecture/notifications/DEVELOPER-TESTING.md) also documents
 * curling the real route, which is the closer-to-production way to trigger it.
 *
 * Usage: pnpm notifications:tick
 */
import { NotificationTickService } from "@/modules/notifications/backend/notification-tick.service";
import prisma from "@/lib/prisma";

async function main() {
  const result = await NotificationTickService.run();
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
