/**
 * Phase VII — Razorpay TEST trial and Offer verification helper (a development tool).
 *
 * Drives the real command runner, checkout command, provider, sync and apply
 * path against the DEV database and Razorpay TEST, for the scenarios in
 * docs/architecture/subscription/implementation-plan/phase-VII/manual-test.md.
 * Authenticating a trial (or paying with an Offer) needs a customer to complete
 * Razorpay Checkout (hCaptcha blocks headless Checkout), so those scenarios
 * start the checkout here for a user named by e-mail, then finish it in the UI
 * (/user/billing, "Continue checkout"), then come back here to observe.
 *
 *   API-only (no browser):
 *     trial-abandon [--trial-seconds N]
 *         A fresh verification user starts a TRIAL checkout (PRO monthly), the
 *         stored start_at is compared with what Razorpay reports, then the
 *         checkout is abandoned through the customer cancel. Runbook T0.
 *     offer-misconfigured
 *         A checkout carrying a code whose Offer ID Razorpay does not know
 *         (well formed, unknown; injected here, no catalog edit): expect
 *         CODE_REFUSED_BY_PROVIDER, the record ABANDONED, an OFFER_REJECTED
 *         alert, and no Razorpay subscription left behind. Runbook O4.
 *
 *   On a user (--email), for the browser scenarios:
 *     trial-start --email E [--plan P --cycle C] [--trial-seconds N]
 *         Starts a TRIAL checkout (the server's start_at is now + the trial
 *         length; --trial-seconds shortens it for T4/T5 only). Finish it from
 *         /user/billing ("Continue checkout"). Runbook T1.
 *     offer-start --email E --code C [--plan P --cycle C]
 *         Starts a checkout carrying a marketing code from the SHIPPED catalog
 *         (add the TEST Offer to config/offer-catalog.ts first). Finish it from
 *         /user/billing. Runbook O1.
 *     sync --email E             a targeted priority-1 sync of the user's open subscription
 *     status --email E           subscriptions, operations, history, anomalies, what Razorpay
 *                                reports, the summary (trial flag, applied code)
 *     cancel --email E           the customer cancel (a trial cancels IMMEDIATELY). Runbook T3.
 *     cleanup --email E          immediately cancels the user's open TEST subscriptions
 *
 * TEST only: it refuses unless the provider mode resolves to TEST. It never
 * prints a key secret or a raw payload. It creates no plans and no Offers
 * (Offers can only be created in the Razorpay Dashboard).
 */
import "dotenv/config";

import prisma from "@/lib/prisma";
import { BillingSummaryService } from "@/modules/billing/backend/billing-summary.service";
import { AdminCancelCommand } from "@/modules/billing/backend/commands/admin-cancel";
import { CancelSubscriptionCommand } from "@/modules/billing/backend/commands/cancel";
import { CommandRunner } from "@/modules/billing/backend/commands/command-runner";
import { StartCheckoutCommand } from "@/modules/billing/backend/commands/start-checkout";
import { createStaticOfferCodeSource } from "@/modules/billing/backend/offers/offer-code-source";
import { SyncService } from "@/modules/billing/backend/sync/sync.service";
import { createOfferCatalog } from "@/modules/billing/config/offer-catalog";
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
    throw new Error("billing:promo-verify runs only against Razorpay TEST (RAZORPAY_KEY_ID rzp_test_…, BILLING_EXPECTED_MODE=test).");
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

function optionalPlan(flags: Flags): { plan: Plan; cycle: Cycle } {
  const plan = (typeof flags.plan === "string" ? flags.plan : "PRO").toUpperCase();
  const cycle = (typeof flags.cycle === "string" ? flags.cycle : "MONTHLY").toUpperCase();

  if (plan !== "PRO" && plan !== "PRO_PLUS") throw new Error("--plan must be PRO or PRO_PLUS");
  if (cycle !== "MONTHLY" && cycle !== "YEARLY") throw new Error("--cycle must be MONTHLY or YEARLY");

  return { plan, cycle };
}

function trialSeconds(flags: Flags): number | undefined {
  if (flags["trial-seconds"] === undefined) return undefined;

  const seconds = Number.parseInt(flag(flags, "trial-seconds"), 10);

  if (!Number.isFinite(seconds) || seconds < 60) throw new Error("--trial-seconds must be at least 60");

  return seconds;
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
        startAt: outcome.value.startAt,
        chargeAt: outcome.value.chargeAt,
        currentEnd: outcome.value.currentEnd,
        paidCount: outcome.value.paidCount,
        offerId: outcome.value.offerId,
        expireBy: outcome.value.expireBy,
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
      kind: true,
      phase: true,
      plan: true,
      cycle: true,
      providerSubscriptionId: true,
      startAt: true,
      expireBy: true,
      currentPeriodEnd: true,
      offerId: true,
      marketingCode: true,
      firstContributedAt: true,
      cancelAtPeriodEnd: true,
      syncDueAt: true,
    },
  });
  const operations = await prisma.billingOperation.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, status: true, parentOperationId: true, request: true, failureClass: true, providerErrorCode: true, requestSentAt: true },
  });
  const history = await prisma.subscriptionHistoryEntry.findMany({
    where: { userId },
    orderBy: { recordedAt: "asc" },
    select: { subscriptionId: true, change: true, fromValue: true, toValue: true, cause: true, trigger: true, recordedAt: true },
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

async function trialAbandon(flags: Flags): Promise<void> {
  requireTest();

  const runner = new CommandRunner();
  const userId = await verificationUser("trial-abandon");
  const started = await runner.run(
    new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY", trial: true }, { trialLengthSeconds: trialSeconds(flags) }),
    asUser(userId),
  );

  log("1 StartCheckout (TRIAL) PRO/MONTHLY", { status: started.status });

  const row = await prisma.subscription.findFirstOrThrow({ where: { userId } });
  const seen = await remote(row.providerSubscriptionId);

  log("2 stored start_at vs Razorpay's (expect equal to the second; kind TRIAL; status created)", {
    kind: row.kind,
    storedStartAt: row.startAt,
    razorpayStartAt: seen && "startAt" in seen ? seen.startAt : null,
    razorpayStatus: seen && "status" in seen ? seen.status : null,
  });

  log("3 Cancel IMMEDIATE (abandon; expect CANCELLED)", await runner.run(new CancelSubscriptionCommand("IMMEDIATE"), asUser(userId)));
  await printUser(userId);
}

async function offerMisconfigured(): Promise<void> {
  requireTest();

  const runner = new CommandRunner();
  const userId = await verificationUser("offer-misconfigured");
  // Well formed (offer_ + 14 characters) but not an Offer in this account; injected, so no catalog edit.
  const offers = createStaticOfferCodeSource(() =>
    createOfferCatalog([
      {
        marketingCode: "VERIFYBOGUS",
        providerOfferId: "offer_AAAAAAAAAAAAAA",
        appliesTo: [{ plan: "PRO", cycle: "MONTHLY" }],
        eligibility: "ANY_USER",
        description: "A deliberately unknown Offer",
      },
    ]),
  );

  try {
    await runner.run(new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY", code: "VERIFYBOGUS" }, { offers }), asUser(userId));
    log("StartCheckout with an unknown Offer", "UNEXPECTED: it succeeded");
  } catch (error) {
    log("StartCheckout with an unknown Offer (expect CODE_REFUSED_BY_PROVIDER)", {
      code: (error as { code?: string }).code,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await printUser(userId);
}

async function trialStart(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const target = optionalPlan(flags);

  log("before: trial on offer", (await summary(user.id, user.role)).allowedActions.trial);

  try {
    const result = await new CommandRunner().run(
      new StartCheckoutCommand({ ...target, trial: true }, { trialLengthSeconds: trialSeconds(flags) }),
      asUser(user.id),
    );

    log("StartCheckout (TRIAL)", result.status === "CHECKOUT_READY" ? { status: result.status, note: "finish it at /user/billing (Continue checkout)" } : result);
  } catch (error) {
    log("StartCheckout (TRIAL) refused", { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code });
  }

  await printUser(user.id);
}

async function offerStart(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const target = optionalPlan(flags);
  const code = flag(flags, "code");

  try {
    const result = await new CommandRunner().run(new StartCheckoutCommand({ ...target, code }), asUser(user.id));

    log(`StartCheckout with code ${code}`, result.status === "CHECKOUT_READY" ? { status: result.status, note: "finish it at /user/billing (Continue checkout)" } : result);
  } catch (error) {
    log(`StartCheckout with code ${code} refused`, { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code });
  }

  await printUser(user.id);
}

async function sync(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const rows = await prisma.subscription.findMany({ where: { userId: user.id, providerMode: "TEST" }, orderBy: { createdAt: "desc" } });
  const target = rows.find((row) => isOpenPhase(row.phase) && row.providerSubscriptionId);

  if (!target) throw new Error("the user has no open, bound subscription");

  log("sync", await new SyncService().syncTargeted(target.id, ProviderPriority.CONFIRMATION));
  await printUser(user.id);
}

async function status(flags: Flags): Promise<void> {
  const user = await userByEmail(flag(flags, "email"));

  await printUser(user.id);

  const state = await summary(user.id, user.role);

  log("summary", { plan: state.plan, subscription: state.subscription, trial: state.allowedActions.trial, cancel: state.allowedActions.cancel, resume: state.allowedActions.resumeCheckout });
}

async function cancel(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));

  try {
    log("Cancel IMMEDIATE", await new CommandRunner().run(new CancelSubscriptionCommand("IMMEDIATE"), asUser(user.id)));
  } catch (error) {
    log("Cancel refused", { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code });
  }

  await printUser(user.id);
}

async function cleanup(flags: Flags): Promise<void> {
  requireTest();

  const user = await userByEmail(flag(flags, "email"));
  const rows = await prisma.subscription.findMany({ where: { userId: user.id, providerMode: "TEST" } });
  const runner = new CommandRunner();

  for (const row of rows.filter((candidate) => isOpenPhase(candidate.phase) && candidate.providerSubscriptionId)) {
    try {
      log(
        `cleanup ${row.id}`,
        await runner.run(new AdminCancelCommand(row.id, "verification cleanup"), {
          actor: { userId: user.id, actorKind: "ADMIN", actorUserId: "billing-promo-verify" },
          idempotencyKey: key("cleanup"),
        }),
      );
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
    case "trial-abandon":
      return trialAbandon(flags);
    case "offer-misconfigured":
      return offerMisconfigured();
    case "trial-start":
      return trialStart(flags);
    case "offer-start":
      return offerStart(flags);
    case "sync":
      return sync(flags);
    case "status":
      return status(flags);
    case "cancel":
      return cancel(flags);
    case "cleanup":
      return cleanup(flags);
    default:
      throw new Error(
        "usage: billing-promo-verify <trial-abandon [--trial-seconds N] | offer-misconfigured | trial-start --email E [--plan P --cycle C --trial-seconds N] | offer-start --email E --code C [--plan P --cycle C] | sync --email E | status --email E | cancel --email E | cleanup --email E>",
      );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
