/**
 * Read-only snapshot of notification delivery state, for local debugging.
 *
 * Prints: whether the push provider resolves to FCM or the fake, the most
 * recent notifications and their per-channel deliveries, push subscriptions,
 * recent delivery attempts (including the raw provider response), and any
 * notification jobs that are not yet COMPLETED.
 *
 * Referenced by docs/architecture/notifications/DEVELOPER-TESTING.md — the
 * "Prisma/database verification" and "Debugging decision tree" sections walk
 * through reading this output.
 *
 * Usage: pnpm notifications:diagnose
 */
import prisma from "@/lib/prisma";
import { isPushConfigured, readFirebaseConfig } from "@/modules/notifications/delivery/push-provider.factory";

async function main() {
  console.log("=== Push provider configuration ===");
  console.log("isPushConfigured():", isPushConfigured());
  const config = readFirebaseConfig();
  console.log("FIREBASE_PROJECT_ID set:", !!config?.projectId);
  console.log("FIREBASE_CLIENT_EMAIL set:", !!config?.clientEmail);
  console.log(
    "FIREBASE_PRIVATE_KEY looks PEM-shaped:",
    !!config?.privateKey?.includes("BEGIN") && !!config?.privateKey?.includes("PRIVATE KEY"),
  );
  console.log(
    isPushConfigured()
      ? "-> getPushProvider() resolves to FcmPushProvider: pushes are really sent."
      : "-> getPushProvider() resolves to FakePushProvider: every WEB_PUSH delivery will be SKIPPED.",
  );

  console.log("\n=== Recent notifications (last 20) ===");
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { deliveries: true },
  });
  for (const n of notifications) {
    console.log(`- [${n.intent}] ${n.id} user=${n.userId} createdAt=${n.createdAt.toISOString()}`);
    for (const d of n.deliveries) {
      console.log(
        `    ${d.channel} status=${d.status} attempts=${d.attempts}/${d.maxAttempts}` +
          (d.failureReason ? ` failureReason="${d.failureReason}"` : "") +
          (d.providerMessageId ? ` providerMessageId=${d.providerMessageId}` : "") +
          (d.nextAttemptAt ? ` nextAttemptAt=${d.nextAttemptAt.toISOString()}` : ""),
      );
    }
  }

  console.log("\n=== Push subscriptions (last 20) ===");
  const subscriptions = await prisma.pushSubscription.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: 20,
  });
  for (const s of subscriptions) {
    console.log(
      `- ${s.id} user=${s.userId} status=${s.status} consecutiveFailures=${s.consecutiveFailures}` +
        ` lastSeenAt=${s.lastSeenAt?.toISOString() ?? "never"}`,
    );
  }

  console.log("\n=== Recent delivery attempts (last 20) ===");
  const attempts = await prisma.notificationDeliveryAttempt.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  for (const a of attempts) {
    console.log(
      `- delivery=${a.deliveryId} attempt#${a.attemptNumber} outcome=${a.outcome ?? "(in progress)"}` +
        (a.errorCode ? ` errorCode=${a.errorCode}` : ""),
    );
  }

  console.log("\n=== Notification jobs not yet COMPLETED (last 20) ===");
  const jobs = await prisma.notificationJob.findMany({
    where: { status: { not: "COMPLETED" } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (jobs.length === 0) console.log("(none)");
  for (const j of jobs) {
    console.log(
      `- ${j.kind} status=${j.status} attempts=${j.attempts}/${j.maxAttempts} runAt=${j.runAt.toISOString()}` +
        (j.lastError ? ` lastError="${j.lastError}"` : ""),
    );
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
