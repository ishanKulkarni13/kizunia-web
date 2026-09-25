"use client";

import { AlertCircleIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { accessForPlan, Capability, PLAN_DISPLAY_NAME, type EffectivePlan } from "@/lib/entitlements/catalog";
import { ApiError } from "@/lib/http";

import { BillingApi, type BillingSummaryDTO, type StartCheckoutResult } from "../../api/billing-api";
import { useBillingSummary } from "../hooks/use-billing-summary";
import { openRazorpayCheckout } from "../razorpay-checkout";

type PaidPlan = "PRO" | "PRO_PLUS";
type Cycle = "MONTHLY" | "YEARLY";

const PAID_PLANS: readonly PaidPlan[] = ["PRO", "PRO_PLUS"];

/** Copy only: what each capability is called. Which plan has which comes from the shared catalog. */
const CAPABILITY_LABEL: Record<Capability, string> = {
  [Capability.PORTFOLIO]: "Public portfolio",
  [Capability.DEADLINE_NOTIFICATIONS]: "Deadline notifications",
  [Capability.RECOMMENDATIONS]: "Competition recommendations",
  [Capability.MCP]: "Use Kizunia through MCP",
};

const CYCLE_LABEL: Record<Cycle, string> = { MONTHLY: "Monthly", YEARLY: "Yearly" };

const PHASE_LABEL: Record<string, string> = {
  PROVISIONING: "Being set up",
  PENDING_AUTHENTICATION: "Waiting for payment",
  TRIALING: "Trial",
  ACTIVE: "Active",
  PAST_DUE: "Payment retrying",
  HALTED: "On hold",
  PAUSED: "Paused",
};

const REFUSAL_MESSAGE: Record<string, string> = {
  SUBSCRIPTION_EXISTS: "You already have an active paid subscription.",
  SUPERSESSION_REQUIRED: "Your subscription is on hold. Update your payment method to resume it.",
  CONTACT_SUPPORT: "Your billing needs a quick review. Please contact support.",
  CHECKOUT_IN_PROGRESS: "A checkout is being set up. Try again in a moment.",
};

const PLAN_CHANGE_MESSAGE: Record<string, string> = {
  NATIVE_UPDATE_POSSIBLE: "Plan changes for your payment method arrive soon.",
  V1_LIMITATION:
    "To switch plans, cancel at the end of your billing period and choose the new plan once it ends. Your access continues until then.",
  UNKNOWN: "Plan changes arrive soon.",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatDate(iso: string | null): string | null {
  return iso === null ? null : new Date(iso).toLocaleDateString();
}

/**
 * The user's billing page: the current plan, and the plans they may buy.
 *
 * Every decision is the server's: which plans may be started or resumed
 * (`allowedActions`), whether a checkout is finishing up or being confirmed
 * (`facets`), and whether billing is available at all. The component renders
 * those answers, opens Razorpay Checkout with the server's key and
 * subscription, and polls `/me/billing` — never Razorpay — until access
 * changes.
 */
export function BillingPanel() {
  const { summary, loading, failed, refresh, watch, polling } = useBillingSummary();
  const [cycle, setCycle] = useState<Cycle>("MONTHLY");
  const [busyIntent, setBusyIntent] = useState<string | null>(null);
  // One Idempotency-Key per click, reused if that click is retried after a network failure.
  const pendingKeys = useRef(new Map<string, string>());

  if (loading && !summary) return <BillingSkeleton />;

  if (!summary) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>Billing could not be loaded</AlertTitle>
        <AlertDescription>{failed ? "Please refresh the page." : null}</AlertDescription>
      </Alert>
    );
  }

  async function choose(plan: PaidPlan) {
    const intentId = `${plan}:${cycle}`;
    const idempotencyKey = pendingKeys.current.get(intentId) ?? crypto.randomUUID();

    pendingKeys.current.set(intentId, idempotencyKey);
    setBusyIntent(intentId);

    let result: StartCheckoutResult;

    try {
      result = await BillingApi.startCheckout({ plan, cycle }, idempotencyKey);
    } catch (error) {
      // An answer from the server is final for this click; a network failure keeps the key for a retry.
      if (error instanceof ApiError) pendingKeys.current.delete(intentId);
      toast.error(errorMessage(error, "We couldn't start your checkout. Please try again."));
      setBusyIntent(null);
      await refresh();

      return;
    }

    pendingKeys.current.delete(intentId);

    if (result.status !== "CHECKOUT_READY") {
      setBusyIntent(null);
      if (result.status === "CONFIRMING") toast.info("We're confirming your checkout. This can take a few minutes.");
      watch();
      await refresh();

      return;
    }

    try {
      await openRazorpayCheckout({
        keyId: result.checkout.keyId,
        subscriptionId: result.checkout.subscriptionId,
        description: `${PLAN_DISPLAY_NAME[result.checkout.plan]} · ${CYCLE_LABEL[result.checkout.cycle]}`,
        onAuthorized: (response) => {
          watch();
          void BillingApi.confirmCheckout(response)
            .then(() => refresh())
            .catch((error: unknown) => toast.error(errorMessage(error, "We couldn't confirm your payment yet.")))
            .finally(() => setBusyIntent(null));
        },
        onClosed: () => {
          setBusyIntent(null);
          void refresh();
        },
      });
    } catch (error) {
      setBusyIntent(null);
      toast.error(errorMessage(error, "Checkout could not be opened. Check your connection and try again."));
    }
  }

  const available = summary.allowedActions.startCheckout;
  const cycles = (["MONTHLY", "YEARLY"] as const).filter((c) => available.some((intent) => intent.cycle === c));

  return (
    <div className="flex flex-col gap-4">
      <CurrentPlanCard summary={summary} />
      <StatusAlerts summary={summary} polling={polling} />

      {summary.billingAvailable && (
        <Card>
          <CardHeader>
            <CardTitle>Plans</CardTitle>
            <CardDescription>The price is shown in the secure checkout before you pay.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {cycles.length > 1 && (
              <Tabs value={cycle} onValueChange={(value) => setCycle(value as Cycle)}>
                <TabsList>
                  {cycles.map((c) => (
                    <TabsTrigger key={c} value={c}>
                      {CYCLE_LABEL[c]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {PAID_PLANS.map((plan) => {
                const intentId = `${plan}:${cycle}`;
                const allowed = available.some((intent) => intent.plan === plan && intent.cycle === cycle);
                const resumable =
                  summary.allowedActions.resumeCheckout?.plan === plan && summary.allowedActions.resumeCheckout.cycle === cycle;
                const current = summary.plan === plan && summary.subscription?.cycle === cycle;

                return (
                  <PlanCard
                    key={plan}
                    plan={plan}
                    current={current}
                    action={
                      allowed ? (
                        <LoadingButton
                          loading={busyIntent === intentId}
                          disabled={busyIntent !== null}
                          onClick={() => void choose(plan)}
                        >
                          {resumable ? "Continue checkout" : `Choose ${PLAN_DISPLAY_NAME[plan]}`}
                        </LoadingButton>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CurrentPlanCard({ summary }: { summary: BillingSummaryDTO }) {
  const renews = formatDate(summary.subscription?.currentPeriodEnd ?? null);

  return (
    <Card>
      <CardHeader>
        <CardDescription>Your plan</CardDescription>
        <CardTitle className="flex items-center gap-2 text-2xl">
          {PLAN_DISPLAY_NAME[summary.plan]}
          {summary.subscription && (
            <Badge variant="secondary">
              {PHASE_LABEL[summary.subscription.phase] ?? summary.subscription.phase}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <ul className="grid gap-1 sm:grid-cols-2">
          <CapabilityItem on={summary.capabilities.portfolio} label={CAPABILITY_LABEL.PORTFOLIO} />
          <CapabilityItem on={summary.capabilities.deadlineNotifications} label={CAPABILITY_LABEL.DEADLINE_NOTIFICATIONS} />
          <CapabilityItem on={summary.capabilities.recommendations} label={CAPABILITY_LABEL.RECOMMENDATIONS} />
          <CapabilityItem on={summary.capabilities.mcp} label={CAPABILITY_LABEL.MCP} />
        </ul>
        <p className="mt-2">Up to {summary.quotas.ownedProjects} owned projects.</p>
      </CardContent>
      {summary.subscription && renews && summary.subscription.phase === "ACTIVE" && (
        <CardFooter className="text-sm text-muted-foreground">
          {summary.subscription.cancelAtPeriodEnd ? `Ends on ${renews}.` : `Renews on ${renews}.`}
        </CardFooter>
      )}
    </Card>
  );
}

function StatusAlerts({ summary, polling }: { summary: BillingSummaryDTO; polling: boolean }) {
  if (!summary.billingAvailable) {
    return (
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>Paid subscriptions are temporarily unavailable</AlertTitle>
        <AlertDescription>Your current plan and access are not affected. Please check back later.</AlertDescription>
      </Alert>
    );
  }

  if (summary.facets.finishingUp) {
    return (
      <Alert>
        <Loader2Icon className="animate-spin" />
        <AlertTitle>Finishing up…</AlertTitle>
        <AlertDescription>We&apos;re confirming your payment. This usually takes a few seconds.</AlertDescription>
      </Alert>
    );
  }

  if (summary.facets.confirming) {
    return (
      <Alert>
        {polling ? <Loader2Icon className="animate-spin" /> : <AlertCircleIcon />}
        <AlertTitle>Confirming your checkout</AlertTitle>
        <AlertDescription>We&apos;re confirming your last billing change. You don&apos;t need to do anything.</AlertDescription>
      </Alert>
    );
  }

  const refusal = summary.allowedActions.refusal;

  if (refusal && REFUSAL_MESSAGE[refusal]) {
    const planChange = summary.allowedActions.planChange;

    return (
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>{REFUSAL_MESSAGE[refusal]}</AlertTitle>
        {planChange && refusal === "SUBSCRIPTION_EXISTS" && <AlertDescription>{PLAN_CHANGE_MESSAGE[planChange]}</AlertDescription>}
      </Alert>
    );
  }

  return null;
}

function PlanCard({ plan, current, action }: { plan: PaidPlan; current: boolean; action: React.ReactNode }) {
  const access = accessForPlan(plan as EffectivePlan);

  return (
    <Card className={current ? "border-primary" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {PLAN_DISPLAY_NAME[plan]}
          {current && <Badge>Current</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <ul className="flex flex-col gap-1">
          {Object.values(Capability)
            .filter((capability) => access.capabilities[capability])
            .map((capability) => (
              <CapabilityItem key={capability} on label={CAPABILITY_LABEL[capability]} />
            ))}
        </ul>
        <p className="mt-2 text-muted-foreground">Up to {access.quotas.OWNED_PROJECTS} owned projects.</p>
      </CardContent>
      {action && <CardFooter>{action}</CardFooter>}
    </Card>
  );
}

function CapabilityItem({ on, label }: { on: boolean; label: string }) {
  return (
    <li className={on ? "flex items-center gap-2" : "flex items-center gap-2 opacity-50"}>
      <CheckIcon className={on ? "size-4 text-primary" : "size-4 invisible"} />
      {label}
    </li>
  );
}

function BillingSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
