/**
 * Phase VI — Razorpay TEST lifecycle verification helper (a development tool).
 *
 * Drives the real command runner, commands, provider, sync and apply path
 * against the DEV database and Razorpay TEST, for the scenarios in
 * docs/architecture/subscription/implementation-plan/phase-VI/manual-test.md.
 * Card states beyond `created` need a customer to authenticate through
 * Razorpay Checkout (hCaptcha blocks headless Checkout), so those subcommands
 * act on a user who completed a checkout in the UI, named by e-mail.
 *
 *   API-only (no browser):
 *     abandon
 *         A fresh verification user starts a checkout (PRO monthly, `created`),
 *         then cancels it through the customer cancel (IMMEDIATE = abandon).
 *         Runbook C1.
 *     update-refusal
 *         A fresh checkout (`created`), then a plan update at both timings sent
 *         straight through the provider: each must classify REJECTED with
 *         nothing changed. Runbook P6.
 *
 *   On a user who completed a checkout in the UI (--email):
 *     cancel --email E --timing CYCLE_END|IMMEDIATE      runbook C2, C4–C6, C9
 *     change-plan --email E --plan P --cycle C           runbook P1–P5
 *     supersede --email E --plan P --cycle C             runbook S1–S3 (prints the checkout
 *                                                        to complete in the browser)
 *     admin-cancel --email E --admin-email A --reason R  runbook A1 (A must be SUPER_ADMIN)
 *     recovery --email E                                 runbook R1 (is the card change offered?)
 *     check --email E                                    "check now" (runbook R1)
 *     status --email E                                   subscriptions, operations, history,
 *                                                        anomalies, and what Razorpay reports
 *     cleanup --email E                                  immediately cancels the user's open
 *                                                        TEST subscriptions (an admin-kind
 *                                                        operation, reason "verification cleanup")
 *
 * TEST only: it refuses unless the provider mode resolves to TEST. It never
 * prints a key secret or a raw payload. It creates no plans (the four TEST
 * plans exist; `pnpm billing:test-plans`).
 */
import "dotenv/config";

import prisma from "@/lib/prisma";
import { BillingSummaryService } from "@/modules/billing/backend/billing-summary.service";
import { AdminCancelCommand, AdminCancelService } from "@/modules/billing/backend/commands/admin-cancel";
import { CancelSubscriptionCommand } from "@/modules/billing/backend/commands/cancel";
import { ChangePlanCommand } from "@/modules/billing/backend/commands/change-plan";
import { CommandRunner } from "@/modules/billing/backend/commands/command-runner";
import { StartCheckoutCommand } from "@/modules/billing/backend/commands/start-checkout";
import { SupersedeCommand } from "@/modules/billing/backend/commands/supersede";
import { RecoveryService } from "@/modules/billing/backend/recovery.service";
import { isOpenPhase } from "@/modules/billing/policy/state-mapping";
import { getBillingProvider } from "@/modules/billing/provider/provider-factory";
import { getProviderMode } from "@/modules/billing/provider/provider-mode";
import { ProviderPriority } from "@/modules/billing/provider/types";

type Flags = Record<string, string | true>;
type Plan = "PRO" | "PRO_PLUS";
type Cycle = "MONTHLY" | "YEARLY";

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
    throw new Error("billing:lifecycle-verify runs only against Razorpay TEST (RAZORPAY_KEY_ID rzp_test_…, BILLING_EXPECTED_MODE=test).");
  }
}

const log = (label: string, value: unknown = "") =>
  console.log(`${new Date().toISOString()}  ${label}`, typeof value === "string" ? value : JSON.stringify(value));

const key = (label: string) => `verify-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function flag(flags: Flags, name: string): string {
  const value = flags[name];

  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${name} is required`);

  return value.trim();
}

function planFlags(flags: Flags): { plan: Plan; cycle: Cycle } {
  const plan = flag(flags, "plan").toUpperCase();
  const cycle = flag(flags, "cycle").toUpperCase();

  if (plan !== "PRO" && plan !== "PRO_PLUS") throw new Error("--plan must be PRO or PRO_PLUS");
  if (cycle !== "MONTHLY" && cycle !== "YEARLY") throw new Error("--cycle must be MONTHLY or YEARLY");

  return { plan, cycle };
}

async function userByEmail(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });

  if (!user) throw new Error(`no user with the e-mail ${email}`);

  return { id: user.id, role: user.role ?? "user" };
}

async function verificationUser(tag: string): Promise<string> {
  const id = `billing-verify-${tag}-${Date.now()}`;

  await prisma.user.create({ data: { id, name: `Billing verify (${tag})`, email: `${id}@example.test` } });
  log("verification user", { id, email: `${id}@example.test` });

  return id;
}

const asUser = (userId: string) => ({ actor: { userId, actorKind: "USER" as const, actorUserId: userId }, idempotencyKey: key("user") });

/** What Razorpay reports now (a priority-2 read; never a mutation). */
async function remote(providerSubscriptionId: string | null) {
  if (!providerSubscriptionId) return null;

  const outcome = await getBillingProvider(ProviderPriority.CONFIRMATION).fetchSubscription(providerSubscriptionId);

  return outcome.kind === "SUCCESS"
    ? {
        status: outcome.value.rawStatus,
        plan: outcome.value.providerPlanId,
        currentEnd: outcome.value.currentEnd,
        hasScheduledChanges: outcome.value.hasScheduledChanges,
        changeScheduledAt: outcome.value.changeScheduledAt,
        paymentMethod: outcome.value.paymentMethod,
      }
    : outcome;
}

async function printUser(userId: string): Promise<void> {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      phase: true,
      plan: true,
      cycle: true,
      providerSubscriptionId: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      cancelRequestedAt: true,
      scheduledPlan: true,
      scheduledCycle: true,
      scheduledChangeAt: true,
      supersededById: true,
      advisoryPaymentMethod: true,
      advisoryInternationalCard: true,
      syncDueAt: true,
    },
  });
  const operations = await prisma.billingOperation.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      status: true,
      parentOperationId: true,
      subscriptionId: true,
      actorKind: true,
      request: true,
      failureClass: true,
      providerErrorCode: true,
      requestSentAt: true,
    },
  });
  const history = await prisma.subscriptionHistoryEntry.findMany({
    where: { userId },
    orderBy: { recordedAt: "asc" },
    select: { subscriptionId: true, change: true, fromValue: true, toValue: true, cause: true, trigger: true, operationId: true, recordedAt: true },
  });
  const anomalies = await prisma.billingAnomaly.findMany({
    where: { userId },
    select: { type: true, subjectKey: true, details: true, occurrences: true, resolvedAt: true },
  });

  log("subscriptions", subscriptions);
  for (const subscription of subscriptions) log(`  Razorpay says (${subscription.id})`, await remote(subscription.providerSubscriptionId));
  log("operations", operations);
  log("history", history);
  log("anomalies", anomalies);
}

async function summary(userId: string, role = "user") {
  return new BillingSummaryService().getForUser({ id: userId, role, banned: false } as never);
}

// ---------------------------------------------------------------------------

async function abandon(): Promise<void> {
  requireTest();

  const runner = new CommandRunner();
  const userId = await verificationUser("abandon");
  const started = await runner.run(new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY" }), asUser(userId));

  log("1 StartCheckout PRO/MONTHLY", { status: started.status });

  const cancelled = await runner.run(new CancelSubscriptionCommand("IMMEDIATE"), asUser(userId));

  log("2 Cancel IMMEDIATE (abandon; expect CANCELLED, observed by a fetch)", cancelled);
  await printUser(userId);
}

async function updateRefusal(): Promise<void> {
  requireTest();

  const runner = new CommandRunner();
  const userId = await verificationUser("update-refusal");

  await runner.run(new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY" }), asUser(userId));

  const row = await prisma.subscription.findFirstOrThrow({ where: { userId } });
  const provider = getBillingProvider(ProviderPriority.COMMAND);

  for (const scheduleChangeAt of ["NOW", "CYCLE_END"] as const) {
    const outcome = await provider.updateSubscriptionPlan(row.providerSubscriptionId!, { plan: "PRO_PLUS", cycle: "MONTHLY", scheduleChangeAt });

    log(`update ${scheduleChangeAt} on a created subscription (expect FAILURE / REJECTED)`, {
      kind: outcome.kind,
      ...(outcome.kind === "FAILURE" && { failureClass: outcome.failureClass, code: outcome.providerErrorCode }),
    });
  }

  log("Razorpay says (expect unchanged: created, same plan)", await remote(row.providerSubscriptionId));
  log("cleanup", await runner.run(new CancelSubscriptionCommand("IMMEDIATE"), asUser(userId)));
}

async function cancel(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const timing = flag(flags, "timing").toUpperCase();

  if (timing !== "CYCLE_END" && timing !== "IMMEDIATE") throw new Error("--timing must be CYCLE_END or IMMEDIATE");

  log("before", (await summary(user.id, user.role)).allowedActions.cancel);

  try {
    log(`Cancel ${timing}`, await new CommandRunner().run(new CancelSubscriptionCommand(timing), asUser(user.id)));
  } catch (error) {
    log(`Cancel ${timing} refused`, { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code });
  }

  await printUser(user.id);
}

async function changePlan(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const target = planFlags(flags);

  log("before: allowed plan changes", (await summary(user.id, user.role)).allowedActions.changePlan);

  try {
    log(`ChangePlan → ${target.plan}/${target.cycle}`, await new CommandRunner().run(new ChangePlanCommand(target), asUser(user.id)));
  } catch (error) {
    log("ChangePlan refused", {
      error: error instanceof Error ? error.message : String(error),
      code: (error as { code?: string }).code,
      details: (error as { details?: unknown }).details,
    });
  }

  await printUser(user.id);
}

async function supersede(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const target = planFlags(flags);
  const current = (await summary(user.id, user.role)).allowedActions.supersede;

  if (!current) throw new Error("the user has no on-hold subscription to supersede");

  try {
    const result = await new CommandRunner().run(
      new SupersedeCommand({ ...target, supersedesSubscriptionId: current.subscriptionId }),
      asUser(user.id),
    );

    log("Supersede", result.status === "CHECKOUT_READY" ? { status: result.status, subscriptionId: result.checkout.subscriptionId, note: "complete it from /user/billing (Continue checkout)" } : result);
  } catch (error) {
    log("Supersede refused", { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code });
  }

  await printUser(user.id);
}

async function adminCancel(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const admin = await userByEmail(flag(flags, "admin-email"));
  const reason = flag(flags, "reason");
  const open = await prisma.subscription.findMany({ where: { userId: user.id, providerMode: "TEST" }, orderBy: { createdAt: "desc" } });
  const target = open.find((row) => isOpenPhase(row.phase) && row.providerSubscriptionId);

  if (!target) throw new Error("the user has no open, bound subscription");

  try {
    log("Admin cancel", await new AdminCancelService().cancel({ id: admin.id, role: admin.role, banned: false } as never, target.id, { reason }, key("admin")));
  } catch (error) {
    log("Admin cancel refused", { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code });
  }

  await printUser(user.id);
}

async function recovery(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));

  try {
    const params = await new RecoveryService().recoveryParams({ id: user.id, role: user.role, banned: false } as never);

    log("Recovery offered (open it from /user/billing: Update payment method)", { subscriptionId: params.subscriptionId, keyIdIsTest: params.keyId.startsWith("rzp_test_") });
  } catch (error) {
    log("Recovery refused", { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code });
  }
}

async function check(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const result = await new RecoveryService().checkNow({ id: user.id, role: user.role, banned: false } as never);

  log("Check now", { syncOutcome: result.syncOutcome, subscription: result.subscription, facets: result.facets, plan: result.plan });
}

async function status(flags: Flags): Promise<void> {
  const user = await userByEmail(flag(flags, "email"));

  await printUser(user.id);
  log("summary", await summary(user.id, user.role));
}

async function cleanup(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const rows = await prisma.subscription.findMany({ where: { userId: user.id, providerMode: "TEST" } });
  const runner = new CommandRunner();

  for (const row of rows.filter((candidate) => isOpenPhase(candidate.phase) && candidate.providerSubscriptionId)) {
    try {
      const result = await runner.run(new AdminCancelCommand(row.id, "verification cleanup"), {
        actor: { userId: user.id, actorKind: "ADMIN", actorUserId: "billing-lifecycle-verify" },
        idempotencyKey: key("cleanup"),
      });

      log(`cleanup ${row.id}`, result);
    } catch (error) {
      log(`cleanup ${row.id} refused`, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  await printUser(user.id);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (command) {
    case "abandon":
      return abandon();
    case "update-refusal":
      return updateRefusal();
    case "cancel":
      return cancel(flags);
    case "change-plan":
      return changePlan(flags);
    case "supersede":
      return supersede(flags);
    case "admin-cancel":
      return adminCancel(flags);
    case "recovery":
      return recovery(flags);
    case "check":
      return check(flags);
    case "status":
      return status(flags);
    case "cleanup":
      return cleanup(flags);
    default:
      throw new Error(
        "usage: billing-lifecycle-verify <abandon | update-refusal | cancel --email E --timing T | change-plan --email E --plan P --cycle C | supersede --email E --plan P --cycle C | admin-cancel --email E --admin-email A --reason R | recovery --email E | check --email E | status --email E | cleanup --email E>",
      );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
