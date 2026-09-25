/**
 * Phase V — Razorpay TEST checkout verification helper (a development tool).
 *
 * Drives the real command runner, provider, sync and orphan scan against the
 * DEV database and Razorpay TEST, for the parts of Phase V that need no
 * browser. The card checkout itself is manual (hCaptcha blocks headless
 * Checkout): see docs/architecture/subscription/implementation-plan/phase-V/README.md.
 *
 *   flow
 *       As a fresh verification user: StartCheckout (PRO monthly), a same-key
 *       retry, a new-key reuse, then a plan switch (abandon-then-create:
 *       cancel, targeted sync, create). Prints what Kizunia recorded and what
 *       Razorpay reports (status, notes, expire_by).
 *   expiry [--seconds 60]
 *       Starts a checkout with a short expire_by and polls Razorpay until it
 *       leaves `created`, printing the lag after expire_by (D6/A8); then syncs
 *       it and shows the local phase.
 *   orphan [--overlap 60]
 *       Two lost creates: one Razorpay really created (only the response is
 *       dropped), one it never received. Runs orphan discovery with no settle
 *       delay: the first is bound through its notes; the second is closed
 *       ABANDONED once the window passes its send time plus the overlap.
 *   scan [--overlap 60]
 *       One orphan-discovery run with no settle delay (as `orphan` uses).
 *   status --email <email>
 *       The user's subscriptions and operations. Never a payload or secret.
 *
 * TEST only: it refuses unless the provider mode resolves to TEST. It never
 * prints a key or secret. It creates no plans (the four TEST plans exist).
 */
import "dotenv/config";

import prisma from "@/lib/prisma";
import { BillingSummaryService } from "@/modules/billing/backend/billing-summary.service";
import { CommandRunner } from "@/modules/billing/backend/commands/command-runner";
import { StartCheckoutCommand, type StartCheckoutResult } from "@/modules/billing/backend/commands/start-checkout";
import { OrphanDiscoveryService } from "@/modules/billing/backend/reconciliation/orphan-discovery.service";
import { SyncService } from "@/modules/billing/backend/sync/sync.service";
import { getBillingProvider } from "@/modules/billing/provider/provider-factory";
import { getProviderMode } from "@/modules/billing/provider/provider-mode";
import {
  providerFailure,
  ProviderPriority,
  type BillingProvider,
  type CreateSubscriptionInput,
} from "@/modules/billing/provider/types";

type Flags = Record<string, string | true>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;

    const next = argv[i + 1];

    if (next !== undefined && !next.startsWith("--")) {
      flags[argv[i].slice(2)] = next;
      i += 1;
    } else {
      flags[argv[i].slice(2)] = true;
    }
  }

  return flags;
}

function requireTest(): void {
  if (getProviderMode() !== "TEST") {
    throw new Error("billing:checkout-verify runs only against Razorpay TEST (RAZORPAY_KEY_ID rzp_test_…, BILLING_EXPECTED_MODE=test).");
  }
}

const log = (label: string, value: unknown = "") =>
  console.log(`${new Date().toISOString()}  ${label}`, typeof value === "string" ? value : JSON.stringify(value));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function verificationUser(tag: string): Promise<string> {
  const id = `billing-verify-${tag}-${Date.now()}`;

  await prisma.user.create({ data: { id, name: `Billing verify (${tag})`, email: `${id}@example.test` } });
  log("verification user", id);

  return id;
}

const key = (label: string) => `verify-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function start(runner: CommandRunner, userId: string, plan: "PRO" | "PRO_PLUS", cycle: "MONTHLY" | "YEARLY", idempotencyKey: string, expireBySeconds?: number) {
  return runner.run(new StartCheckoutCommand({ plan, cycle }, expireBySeconds ? { expireBySeconds } : {}), {
    actor: { userId, actorKind: "USER", actorUserId: userId },
    idempotencyKey,
  });
}

function shown(result: StartCheckoutResult) {
  return result.status === "CHECKOUT_READY"
    ? { status: result.status, operationId: result.operationId, subscriptionId: result.checkout.subscriptionId, plan: result.checkout.plan, cycle: result.checkout.cycle, expireBy: result.checkout.expireBy, keyIdIsTest: result.checkout.keyId.startsWith("rzp_test_") }
    : result;
}

async function remote(psub: string) {
  const outcome = await getBillingProvider(ProviderPriority.CONFIRMATION).fetchSubscription(psub);

  return outcome.kind === "SUCCESS"
    ? { status: outcome.value.rawStatus, notes: outcome.value.notes, expireBy: outcome.value.expireBy, plan: outcome.value.providerPlanId }
    : outcome;
}

async function printUser(userId: string) {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, phase: true, plan: true, cycle: true, providerSubscriptionId: true, expireBy: true, syncDueAt: true, syncReason: true },
  });
  const operations = await prisma.billingOperation.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, status: true, parentOperationId: true, subscriptionId: true, failureClass: true, requestSentAt: true },
  });

  log("subscriptions", subscriptions);
  log("operations", operations);
}

// ---------------------------------------------------------------------------

async function flow(): Promise<void> {
  requireTest();

  const runner = new CommandRunner();
  const userId = await verificationUser("flow");
  const firstKey = key("first");

  const first = await start(runner, userId, "PRO", "MONTHLY", firstKey);
  log("1 StartCheckout PRO/MONTHLY", shown(first));
  if (first.status !== "CHECKOUT_READY") throw new Error("expected a checkout");
  log("  Razorpay says", await remote(first.checkout.subscriptionId));

  const retry = await start(runner, userId, "PRO", "MONTHLY", firstKey);
  log("2 same-key retry (expect identical, no new create)", shown(retry));

  const reuse = await start(runner, userId, "PRO", "MONTHLY", key("reuse"));
  log("3 new key, same plan (expect the same subscription, no provider call)", shown(reuse));

  const switched = await start(runner, userId, "PRO_PLUS", "YEARLY", key("switch"));
  log("4 switch to PRO_PLUS/YEARLY (abandon-then-create)", shown(switched));
  log("  old one at Razorpay", await remote(first.checkout.subscriptionId));
  if (switched.status === "CHECKOUT_READY") log("  new one at Razorpay", await remote(switched.checkout.subscriptionId));

  await printUser(userId);
  log("summary", await new BillingSummaryService().getForUser({ id: userId, role: "user", banned: false } as never));
}

async function expiry(flags: Flags): Promise<void> {
  requireTest();

  const seconds = Number(flags.seconds ?? 60);
  const runner = new CommandRunner();
  const userId = await verificationUser("expiry");
  const result = await start(runner, userId, "PRO", "MONTHLY", key("expiry"), seconds);

  if (result.status !== "CHECKOUT_READY") throw new Error(`expected a checkout, got ${result.status}`);

  const psub = result.checkout.subscriptionId;
  const expireBy = new Date(result.checkout.expireBy!);
  log("created, expire_by", { psub, expireBy });

  for (;;) {
    const state = await remote(psub);
    const status = "status" in state ? state.status : "fetch failed";
    const lagSeconds = Math.round((Date.now() - expireBy.getTime()) / 1000);

    log("poll", { status, secondsAfterExpireBy: lagSeconds });

    if (status !== "created") {
      log("RESULT: left `created` after expire_by by (s, upper bound at 15 s polling)", lagSeconds);
      break;
    }

    if (lagSeconds > 20 * 60) {
      log("RESULT: still `created` 20 minutes after expire_by");
      break;
    }

    await sleep(15_000);
  }

  const sub = await prisma.subscription.findFirstOrThrow({ where: { userId } });
  log("targeted sync", await new SyncService().syncTargeted(sub.id, ProviderPriority.COMMAND, { trigger: "COMMAND_CONFIRM" }));
  await printUser(userId);
}

/** The real provider, except a create's answer is dropped (as if the response were lost), or never sent at all. */
function losingCreates(mode: "LOSE_RESPONSE" | "NEVER_SEND"): (priority: ProviderPriority) => BillingProvider {
  return (priority) => {
    const real = getBillingProvider(priority);

    return new Proxy(real, {
      get(target, property, receiver) {
        if (property !== "createSubscription") return Reflect.get(target, property, receiver);

        return async (input: CreateSubscriptionInput) => {
          const sentAt = new Date();

          if (mode === "LOSE_RESPONSE") {
            const outcome = await target.createSubscription(input);

            log(`  (really created at Razorpay: ${outcome.kind}; dropping the response)`);
          }

          return providerFailure("TIMEOUT", { requestSentAt: sentAt });
        };
      },
    });
  };
}

async function orphan(flags: Flags): Promise<void> {
  requireTest();

  const overlapSeconds = Number(flags.overlap ?? 60);
  const userA = await verificationUser("orphan-lost-response");
  const userB = await verificationUser("orphan-never-sent");

  log("A: create whose response is lost", shown(await start(new CommandRunner({ providerFor: losingCreates("LOSE_RESPONSE") }), userA, "PRO", "MONTHLY", key("lostA"))));
  log("B: create that never reached Razorpay", shown(await start(new CommandRunner({ providerFor: losingCreates("NEVER_SEND") }), userB, "PRO", "MONTHLY", key("lostB"))));

  const scan = () =>
    new OrphanDiscoveryService({ settings: { overlapSeconds, settleDelaySeconds: 0 } }).run({ deadline: new Date(Date.now() + 30_000) });

  log("orphan scan #1", await scan());
  await printUser(userA);
  await printUser(userB);

  log(`waiting ${overlapSeconds + 5} s for the window to pass B's send time plus the overlap…`);
  await sleep((overlapSeconds + 5) * 1000);

  log("orphan scan #2", await scan());
  await printUser(userB);
}

async function scanOnce(flags: Flags): Promise<void> {
  requireTest();

  const overlapSeconds = Number(flags.overlap ?? 60);

  log(
    "orphan scan",
    await new OrphanDiscoveryService({ settings: { overlapSeconds, settleDelaySeconds: 0 } }).run({ deadline: new Date(Date.now() + 30_000) }),
  );

  const userId = typeof flags.user === "string" ? flags.user : null;

  if (userId) await printUser(userId);
}

async function status(flags: Flags): Promise<void> {
  const email = typeof flags.email === "string" ? flags.email : null;

  if (!email) throw new Error("status needs --email");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });

  if (!user) throw new Error("no user with that email");

  await printUser(user.id);
  log("summary", await new BillingSummaryService().getForUser({ id: user.id, role: user.role, banned: false } as never));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (command) {
    case "flow":
      return flow();
    case "expiry":
      return expiry(flags);
    case "orphan":
      return orphan(flags);
    case "scan":
      return scanOnce(flags);
    case "status":
      return status(flags);
    default:
      throw new Error("usage: billing-checkout-verify <flow | expiry [--seconds N] | orphan [--overlap N] | scan [--overlap N] [--user ID] | status --email E>");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
