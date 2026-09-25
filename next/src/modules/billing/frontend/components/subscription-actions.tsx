"use client";

import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { PLAN_DISPLAY_NAME } from "@/lib/entitlements/catalog";
import { ApiError } from "@/lib/http";

import { BillingApi, type BillingSummaryDTO } from "../../api/billing-api";
import { useIdempotencyKeys } from "../hooks/use-idempotency-keys";
import { openRazorpayCheckout } from "../razorpay-checkout";

type PaidPlan = "PRO" | "PRO_PLUS";
type Cycle = "MONTHLY" | "YEARLY";

const CYCLE_LABEL: Record<Cycle, string> = { MONTHLY: "Monthly", YEARLY: "Yearly" };

/** Why a plan change is not offered (the strategy's reason), in customer words. */
const PLAN_CHANGE_UNAVAILABLE: Record<string, string> = {
  PAYMENT_METHOD:
    "Plan changes aren't available for your payment method. To switch plans, cancel at the end of your billing period and choose the new plan once it ends. Your access continues until then.",
  SUBSCRIPTION_STATE: "Plan changes are available once your subscription is active and paid up.",
  PRICE_UNKNOWN: "Plan changes aren't available right now.",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatDate(iso: string | null | undefined): string | null {
  return iso ? new Date(iso).toLocaleDateString() : null;
}

interface ActionProps {
  readonly summary: BillingSummaryDTO;
  /** Reload the summary, and poll while the server reports work in progress. */
  readonly onChanged: () => Promise<unknown>;
  readonly watch: () => void;
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Cancel, with the timing the server says applies (`allowedActions.cancel`).
 * The customer confirms exactly that timing, and the request carries it: if
 * the subscription changed meanwhile the server refuses rather than cancel
 * differently (IB-26 item 2). Nothing is claimed before the server shows it.
 */
export function CancelSubscriptionCard({ summary, onChanged, watch }: ActionProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { keyFor, settle } = useIdempotencyKeys();
  const cancel = summary.allowedActions.cancel;

  if (!cancel || !summary.subscription) return null;

  const endsOn = formatDate(summary.subscription.currentPeriodEnd);
  const copy = cancel.abandon
    ? { title: "Discard this checkout?", body: "The pending checkout is discarded. Nothing has been charged.", action: "Discard checkout" }
    : cancel.timing === "CYCLE_END"
      ? {
          title: "Cancel your subscription?",
          body: `Your subscription ends on ${endsOn ?? "the last day of your billing period"}, and you keep your current plan until then. This can't be undone: to continue afterwards, you'll need to subscribe again.`,
          action: "Cancel at period end",
        }
      : {
          title: "Cancel your subscription now?",
          body: "Your subscription ends now and no further charge will be made. This can't be undone.",
          action: "Cancel now",
        };

  async function confirm() {
    const intent = `cancel:${cancel!.timing}`;

    setBusy(true);

    try {
      const result = await BillingApi.cancel(cancel!.timing, keyFor(intent));

      settle(intent);
      setOpen(false);

      if (result.status === "CANCELLATION_REQUESTED") toast.success(`Cancellation requested. Your subscription ends on ${formatDate(result.endsAt) ?? "the period end"}.`);
      else if (result.status === "CANCELLED") toast.success("Your subscription has been cancelled.");
      else toast.info("We're confirming your cancellation. This can take a few minutes.");

      watch();
    } catch (error) {
      settle(intent, error);
      toast.error(errorMessage(error, "We couldn't cancel your subscription. Please try again."));
    } finally {
      setBusy(false);
      await onChanged();
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {cancel.abandon ? "Discard checkout" : "Cancel subscription"}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep subscription</AlertDialogCancel>
            <LoadingButton variant="destructive" loading={busy} onClick={() => void confirm()}>
              {copy.action}
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// On hold: recovery first, then supersession
// ---------------------------------------------------------------------------

/**
 * A HALTED or PAUSED subscription. Recovery is offered first (Razorpay's own
 * payment-method change, then "check now"); starting a new subscription
 * permanently cancels the old one and needs an explicit confirmation
 * (multiple-subscriptions.md). For UPI subscribers the right order is still
 * PROVIDER-DEPENDENT (IB-22).
 */
export function OnHoldCard({ summary, onChanged, watch }: ActionProps) {
  const [busy, setBusy] = useState<"recover" | "check" | "supersede" | null>(null);
  const [confirming, setConfirming] = useState<{ plan: PaidPlan; cycle: Cycle } | null>(null);
  const { keyFor, settle } = useIdempotencyKeys();
  const { recover, supersede } = summary.allowedActions;
  const subscription = summary.subscription;

  if (!subscription || (!recover && !supersede)) return null;

  const paused = subscription.phase === "PAUSED";
  const previous = `${PLAN_DISPLAY_NAME[subscription.plan]} · ${CYCLE_LABEL[subscription.cycle]}`;

  async function checkNow() {
    setBusy("check");

    try {
      const result = await BillingApi.checkNow();

      toast[result.subscription?.phase === "ACTIVE" ? "success" : "info"](
        result.subscription?.phase === "ACTIVE" ? "Your subscription is active again." : "Your subscription is still on hold.",
      );
    } catch (error) {
      toast.error(errorMessage(error, "We couldn't check your subscription right now."));
    } finally {
      setBusy(null);
      await onChanged();
    }
  }

  async function updatePaymentMethod() {
    setBusy("recover");

    try {
      const params = await BillingApi.recovery();

      await openRazorpayCheckout({
        keyId: params.keyId,
        subscriptionId: params.subscriptionId,
        description: "Update payment method",
        cardChange: true,
        onAuthorized: () => {
          watch();
          void checkNow();
        },
        onClosed: () => setBusy(null),
      });
    } catch (error) {
      setBusy(null);
      toast.error(errorMessage(error, "Payment method update could not be opened. Please try again."));
    }
  }

  async function startNew(plan: PaidPlan, cycle: Cycle) {
    const intent = `supersede:${plan}:${cycle}`;

    setBusy("supersede");

    try {
      const result = await BillingApi.supersede({ plan, cycle, supersedesSubscriptionId: supersede!.subscriptionId }, keyFor(intent));

      settle(intent);
      setConfirming(null);

      if (result.status !== "CHECKOUT_READY") {
        toast.info("We're confirming your previous subscription was cancelled. Try again in a moment.");
        watch();

        return;
      }

      await openRazorpayCheckout({
        keyId: result.checkout.keyId,
        subscriptionId: result.checkout.subscriptionId,
        description: `${PLAN_DISPLAY_NAME[result.checkout.plan]} · ${CYCLE_LABEL[result.checkout.cycle]}`,
        onAuthorized: (response) => {
          watch();
          void BillingApi.confirmCheckout(response).then(() => onChanged());
        },
        onClosed: () => void onChanged(),
      });
    } catch (error) {
      settle(intent, error);
      toast.error(errorMessage(error, "We couldn't start a new subscription. Please try again."));
    } finally {
      setBusy(null);
      await onChanged();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{paused ? "Your subscription is paused" : "Your subscription is on hold"}</CardTitle>
        <CardDescription>
          {paused
            ? `Your ${previous} subscription is paused, so its features are off for now.`
            : `A payment for your ${previous} subscription failed, so its features are off for now.`}{" "}
          You can update your payment method to resume it, or start a new subscription instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {recover && (
          <>
            <LoadingButton loading={busy === "recover"} disabled={busy !== null} onClick={() => void updatePaymentMethod()}>
              Update payment method
            </LoadingButton>
            <LoadingButton variant="outline" loading={busy === "check"} disabled={busy !== null} onClick={() => void checkNow()}>
              <RefreshCwIcon />
              Check now
            </LoadingButton>
          </>
        )}
      </CardContent>
      {supersede && (
        <CardFooter className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">Or start a new subscription (this permanently cancels the one on hold):</p>
          <div className="flex flex-wrap gap-2">
            {supersede.plans.map(({ plan, cycle }) => (
              <Button key={`${plan}:${cycle}`} variant="secondary" disabled={busy !== null} onClick={() => setConfirming({ plan, cycle })}>
                {PLAN_DISPLAY_NAME[plan]} · {CYCLE_LABEL[cycle]}
              </Button>
            ))}
          </div>
        </CardFooter>
      )}
      <AlertDialog open={confirming !== null} onOpenChange={(next) => !next && busy === null && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              Your {previous} subscription will be cancelled permanently. This can&apos;t be undone. If you&apos;d rather keep it,
              update your payment method instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Keep my subscription</AlertDialogCancel>
            <LoadingButton
              variant="destructive"
              loading={busy === "supersede"}
              onClick={() => confirming && void startNew(confirming.plan, confirming.cycle)}
            >
              Cancel it and continue
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Plan change
// ---------------------------------------------------------------------------

/**
 * Native plan changes where the server's strategy offers them (upgrades now,
 * downgrades at the period end); otherwise the documented V1 limitation.
 * Access changes only when Razorpay reports the new plan.
 */
export function PlanChangeCard({ summary, onChanged, watch }: ActionProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const { keyFor, settle } = useIdempotencyKeys();
  const changePlan = summary.allowedActions.changePlan;
  const subscription = summary.subscription;

  if (!changePlan || !subscription) return null;

  const periodEnd = formatDate(subscription.currentPeriodEnd);

  async function change(plan: PaidPlan, cycle: Cycle) {
    const intent = `change:${plan}:${cycle}`;

    setBusy(intent);

    try {
      const result = await BillingApi.changePlan({ plan, cycle }, keyFor(intent));

      settle(intent);

      switch (result.status) {
        case "UPGRADED":
          toast.success(`You're now on ${PLAN_DISPLAY_NAME[result.plan]}.`);
          break;
        case "SCHEDULED":
          toast.success(`Your plan changes to ${PLAN_DISPLAY_NAME[result.plan]} on ${formatDate(result.effectiveAt) ?? "your renewal date"}.`);
          break;
        case "NOT_CHANGED":
          toast.info("Your plan didn't change. If a payment was needed, it may not have gone through.");
          break;
        default:
          toast.info("We're confirming your plan change.");
          watch();
      }
    } catch (error) {
      settle(intent, error);
      toast.error(errorMessage(error, "We couldn't change your plan. Please try again."));
    } finally {
      setBusy(null);
      await onChanged();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change plan</CardTitle>
        <CardDescription>
          Upgrades start now; you pay the prorated difference. Downgrades start on {periodEnd ?? "your renewal date"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {changePlan.options.length === 0 && changePlan.unavailable && (
          <Alert>
            <AlertCircleIcon />
            <AlertTitle>Plan change unavailable</AlertTitle>
            <AlertDescription>{PLAN_CHANGE_UNAVAILABLE[changePlan.unavailable] ?? PLAN_CHANGE_UNAVAILABLE.PRICE_UNKNOWN}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          {changePlan.options.map((option) => {
            const intent = `change:${option.plan}:${option.cycle}`;

            return (
              <LoadingButton key={intent} variant="outline" loading={busy === intent} disabled={busy !== null} onClick={() => void change(option.plan, option.cycle)}>
                {option.scheduleChangeAt === "NOW" ? "Upgrade to" : "Switch to"} {PLAN_DISPLAY_NAME[option.plan]} · {CYCLE_LABEL[option.cycle]}
                {option.scheduleChangeAt === "CYCLE_END" && periodEnd ? ` on ${periodEnd}` : ""}
              </LoadingButton>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
