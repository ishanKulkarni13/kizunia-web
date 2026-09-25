/**
 * Phase IV — Razorpay TEST webhook verification helper (a development tool).
 *
 * Phase V builds checkout; until then this seeds the scene the real webhook
 * verification needs, against the DEV database and Razorpay TEST, and shows
 * what Kizunia recorded. See docs/architecture/subscription/implementation-plan/phase-IV/README.md
 * ("Verification against Razorpay TEST").
 *
 *   seed --email <dev user> [--plan PRO|PRO_PLUS] [--cycle MONTHLY|YEARLY] [--bind]
 *       Writes a PROVISIONING subscription and its CREATE_SUBSCRIPTION operation,
 *       then creates a Razorpay TEST subscription carrying Kizunia's notes
 *       (kz_sub, kz_op, kz_env) and prints its hosted checkout URL.
 *       Without --bind the create response is deliberately NOT bound (the
 *       operation is left OUTCOME_UNKNOWN, labelled in its request as a
 *       verification), so the first webhook exercises binding through notes,
 *       exactly as for a create whose response was lost. With --bind the
 *       response is applied through the one apply path, as a command would.
 *   cancel <subscriptionId>
 *       Immediate cancel at Razorpay TEST, recorded as a CANCEL_IMMEDIATELY
 *       operation (SB-CM-01). The change reaches Kizunia only through a
 *       webhook or a sync, which is what is being verified.
 *   tick
 *       Runs the billing:sync task once, as the tick would (no HTTP needed).
 *   status <subscriptionId>
 *       Prints the subscription, its sync state, history, events, operations
 *       and anomalies. Never a payload, a secret or personal data.
 *
 * TEST only: it refuses unless the provider mode resolves to TEST. It never
 * prints a key or secret.
 */
import "dotenv/config";

import prisma from "@/lib/prisma";
import { BillingSyncTask } from "@/modules/billing/backend/reconciliation/billing-sync.task";
import { applyObservation } from "@/modules/billing/backend/sync/apply";
import { getBillingProvider } from "@/modules/billing/provider/provider-factory";
import { getProviderMode } from "@/modules/billing/provider/provider-mode";
import { ProviderPriority } from "@/modules/billing/provider/types";

type Args = { readonly positional: string[]; readonly flags: Record<string, string | true> };

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const next = argv[i + 1];

    if (next !== undefined && !next.startsWith("--")) {
      flags[arg.slice(2)] = next;
      i += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }

  return { positional, flags };
}

function requireTest(): void {
  if (getProviderMode() !== "TEST") {
    throw new Error("billing:webhook-verify runs only against Razorpay TEST (RAZORPAY_KEY_ID rzp_test_…, BILLING_EXPECTED_MODE=test).");
  }
}

async function seed(flags: Args["flags"]): Promise<void> {
  requireTest();

  const email = typeof flags.email === "string" ? flags.email : null;
  const plan = flags.plan === "PRO_PLUS" ? "PRO_PLUS" : "PRO";
  const cycle = flags.cycle === "YEARLY" ? "YEARLY" : "MONTHLY";

  if (!email) throw new Error("seed needs --email <an existing dev user's email>");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (!user) throw new Error("no user with that email in the dev database");

  const subscription = await prisma.subscription.create({
    data: { userId: user.id, kind: "STANDARD", providerMode: "TEST", plan, cycle, phase: "PROVISIONING" },
  });
  const operation = await prisma.billingOperation.create({
    data: {
      userId: user.id,
      subscriptionId: subscription.id,
      kind: "CREATE_SUBSCRIPTION",
      providerMode: "TEST",
      actorKind: "SYSTEM",
      idempotencyKey: `phase-iv-verify-${subscription.id}`,
      request: { plan, cycle, verification: "Phase IV webhook verification seed" },
    },
  });

  const sentAt = new Date();
  const outcome = await getBillingProvider(ProviderPriority.COMMAND).createSubscription({
    plan,
    cycle,
    totalCount: cycle === "MONTHLY" ? 12 : 1,
    expireBy: new Date(sentAt.getTime() + 2 * 60 * 60 * 1000),
    notes: { kz_sub: subscription.id, kz_op: operation.id, kz_env: "TEST" },
  });

  if (outcome.kind !== "SUCCESS") {
    await prisma.billingOperation.update({
      where: { id: operation.id },
      data: {
        status: outcome.kind === "FAILURE" && outcome.requestSentAt ? "OUTCOME_UNKNOWN" : "REJECTED",
        failureClass: outcome.kind === "FAILURE" ? outcome.failureClass : null,
        requestSentAt: outcome.kind === "FAILURE" ? (outcome.requestSentAt ?? null) : null,
      },
    });

    throw new Error(`create failed: ${outcome.kind === "FAILURE" ? outcome.failureClass : outcome.kind}`);
  }

  if (flags.bind === true) {
    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: subscription.id },
        data: { providerSubscriptionId: outcome.value.providerSubscriptionId },
      }),
      prisma.billingOperation.update({
        where: { id: operation.id },
        data: { status: "SUCCEEDED", requestSentAt: outcome.observationAt, resolvedAt: new Date() },
      }),
      prisma.subscriptionHistoryEntry.create({
        data: {
          subscriptionId: subscription.id,
          userId: user.id,
          change: "BINDING",
          toValue: outcome.value.providerSubscriptionId,
          cause: "KIZUNIA_COMMAND",
          trigger: "COMMAND_RESPONSE",
          operationId: operation.id,
          observationAt: outcome.observationAt,
        },
      }),
    ]);
    await applyObservation(
      subscription.id,
      { state: outcome.value, observationAt: outcome.observationAt },
      { resolvedMode: "TEST", trigger: "COMMAND_RESPONSE" },
    );
  } else {
    await prisma.billingOperation.update({
      where: { id: operation.id },
      data: {
        status: "OUTCOME_UNKNOWN",
        requestSentAt: outcome.observationAt,
        request: {
          plan,
          cycle,
          verification: "Phase IV webhook verification: the create response is deliberately not bound, so the first webhook binds through notes",
          seededProviderSubscriptionId: outcome.value.providerSubscriptionId,
        },
      },
    });
  }

  console.log(`subscriptionId        ${subscription.id}`);
  console.log(`operationId           ${operation.id}`);
  console.log(`providerSubscription  ${outcome.value.providerSubscriptionId}`);
  console.log(`bound                 ${flags.bind === true ? "yes (applied as a command response)" : "no (the first webhook binds it through notes)"}`);
  console.log(`checkout (TEST)       ${outcome.value.shortUrl ?? "(none returned)"}`);
}

async function cancel(subscriptionId: string | undefined): Promise<void> {
  requireTest();

  if (!subscriptionId) throw new Error("cancel needs a subscriptionId");

  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  let providerSubscriptionId = subscription?.providerSubscriptionId ?? null;

  if (!subscription) throw new Error("no such subscription");

  if (providerSubscriptionId === null) {
    // Not bound yet: the seed recorded the provider ID on its create operation.
    const create = await prisma.billingOperation.findFirst({
      where: { subscriptionId, kind: "CREATE_SUBSCRIPTION" },
      select: { request: true },
    });
    const seeded = (create?.request as { seededProviderSubscriptionId?: unknown } | null)?.seededProviderSubscriptionId;
    providerSubscriptionId = typeof seeded === "string" ? seeded : null;
  }

  if (providerSubscriptionId === null) throw new Error("the subscription is not bound to a provider subscription yet");

  const operation = await prisma.billingOperation.create({
    data: {
      userId: subscription.userId,
      subscriptionId,
      kind: "CANCEL_IMMEDIATELY",
      providerMode: "TEST",
      actorKind: "SYSTEM",
      idempotencyKey: `phase-iv-verify-cancel-${subscriptionId}-${Date.now()}`,
      request: { atCycleEnd: false, verification: "Phase IV webhook verification" },
    },
  });
  const outcome = await getBillingProvider(ProviderPriority.COMMAND).cancelSubscription(providerSubscriptionId, {
    atCycleEnd: false,
  });

  await prisma.billingOperation.update({
    where: { id: operation.id },
    data:
      outcome.kind === "SUCCESS"
        ? { status: "SUCCEEDED", requestSentAt: outcome.observationAt, resolvedAt: new Date() }
        : {
            status: outcome.kind === "FAILURE" && outcome.requestSentAt ? "OUTCOME_UNKNOWN" : "REJECTED",
            failureClass: outcome.kind === "FAILURE" ? outcome.failureClass : null,
            requestSentAt: outcome.kind === "FAILURE" ? (outcome.requestSentAt ?? null) : null,
          },
  });

  console.log(`cancel ${outcome.kind === "SUCCESS" ? `accepted; provider status now ${outcome.value.rawStatus}` : `failed: ${outcome.kind === "FAILURE" ? outcome.failureClass : outcome.kind}`}`);
  console.log("Kizunia's own row changes only when a webhook or a sync observes it.");
}

async function tick(): Promise<void> {
  requireTest();
  console.log(JSON.stringify(await new BillingSyncTask().run(), null, 2));
}

async function status(subscriptionId: string | undefined): Promise<void> {
  if (!subscriptionId) throw new Error("status needs a subscriptionId");

  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });

  if (!subscription) throw new Error("no such subscription");

  const [history, events, operations, anomalies] = await Promise.all([
    prisma.subscriptionHistoryEntry.findMany({ where: { subscriptionId }, orderBy: { recordedAt: "asc" } }),
    prisma.billingEvent.findMany({
      where: {
        OR: [
          { subscriptionId },
          ...(subscription.providerSubscriptionId ? [{ providerSubscriptionId: subscription.providerSubscriptionId }] : []),
        ],
      },
      orderBy: { receivedAt: "asc" },
      select: {
        receivedAt: true,
        eventType: true,
        status: true,
        dedupeSource: true,
        dedupeKey: true,
        duplicateCount: true,
        matchedSecret: true,
      },
    }),
    prisma.billingOperation.findMany({ where: { subscriptionId }, orderBy: { createdAt: "asc" } }),
    prisma.billingAnomaly.findMany({ where: { subscriptionIds: { has: subscriptionId } } }),
  ]);

  console.log(
    JSON.stringify(
      {
        subscription: {
          id: subscription.id,
          phase: subscription.phase,
          plan: subscription.plan,
          cycle: subscription.cycle,
          providerStatus: subscription.providerStatus,
          bound: subscription.providerSubscriptionId !== null,
          syncDueAt: subscription.syncDueAt,
          syncReason: subscription.syncReason,
          syncRequestedAt: subscription.syncRequestedAt,
          lastSyncedAt: subscription.lastSyncedAt,
          lastAppliedObservationAt: subscription.lastAppliedObservationAt,
          syncAttempts: subscription.syncAttempts,
          lastSyncFailureClass: subscription.lastSyncFailureClass,
        },
        history: history.map((h) => ({
          at: h.recordedAt,
          change: h.change,
          from: h.fromValue,
          to: h.toValue,
          cause: h.cause,
          trigger: h.trigger,
          viaEvent: h.billingEventId !== null,
        })),
        events,
        operations: operations.map((o) => ({ kind: o.kind, status: o.status, requestSentAt: o.requestSentAt, resolvedAt: o.resolvedAt })),
        anomalies: anomalies.map((a) => ({ type: a.type, occurrences: a.occurrences, resolvedAt: a.resolvedAt })),
      },
      null,
      2,
    ),
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case "seed":
      return seed(args.flags);
    case "cancel":
      return cancel(args.positional[0]);
    case "tick":
      return tick();
    case "status":
      return status(args.positional[0]);
    default:
      throw new Error("usage: billing:webhook-verify seed --email <e> [--bind] | cancel <id> | tick | status <id>");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "billing:webhook-verify failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
