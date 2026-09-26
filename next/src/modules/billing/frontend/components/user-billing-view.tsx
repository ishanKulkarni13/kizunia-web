"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { BillingAdminApi } from "../../api/billing-admin-api";
import type {
  AccessExplanationDTO,
  BillingTimelineDTO,
  ExplainedGrantSourceDTO,
  ExplainedSubscriptionSourceDTO,
} from "../../backend/admin/admin-billing.dto";
import { useIdempotencyKeys } from "../hooks/use-idempotency-keys";
import { anomalyHref, errorMessage, formatDate, humanize } from "./billing-admin-format";
import { BillingTimeline } from "./billing-timeline";
import { ReasonDialog } from "./reason-dialog";

const PLAN_LABEL: Record<string, string> = { FREE: "Free", PRO: "Pro", PRO_PLUS: "Pro+" };

/** A convenience for hiding a button that could only be refused; the server still decides. */
const CANCELLABLE_PHASES = ["PENDING_AUTHENTICATION", "TRIALING", "ACTIVE", "PAST_DUE", "HALTED", "PAUSED"];

function contributionLabel(source: ExplainedSubscriptionSourceDTO | ExplainedGrantSourceDTO): string {
  if (source.kind === "SUBSCRIPTION") {
    return source.contribution === "CONTRIBUTING"
      ? "Contributing"
      : source.contribution === "MODE_MISMATCH"
        ? `Not contributing: a ${source.providerMode} subscription, and this deployment honors another mode`
        : `Not contributing: ${humanize(source.phase)}`;
  }

  return source.contributes ? "Contributing" : `Not contributing: ${humanize(source.state)}`;
}

/**
 * One user's billing, on one page: why they have the access they have (the
 * resolver's own explanation), the actions an administrator may take, and the
 * timeline. It shows what the server returns and hides what the server says the
 * viewer may not do; every action is re-authorized by its API.
 *
 * Sync now (Phase IV) and immediate cancel (Phase VI) are the existing
 * endpoints, called from here rather than reimplemented.
 */
export function UserBillingView({ userId }: { userId: string }) {
  const [explanation, setExplanation] = useState<AccessExplanationDTO | null>(null);
  const [timeline, setTimeline] = useState<BillingTimelineDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const { keyFor, settle } = useIdempotencyKeys();

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const [explained, merged] = await Promise.all([BillingAdminApi.explain(userId), BillingAdminApi.userTimeline(userId)]);
      setExplanation(explained);
      setTimeline(merged);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load this user's billing."));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncNow(subscriptionId: string) {
    setSyncing(subscriptionId);

    try {
      const result = await BillingAdminApi.syncSubscription(subscriptionId);
      toast.success(`Synchronized: ${humanize(result.outcome)}. The subscription is ${humanize(result.phase)}.`);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Could not synchronize."));
    } finally {
      setSyncing(null);
    }
  }

  async function cancelNow(subscriptionId: string, reason: string) {
    const intent = `admin-cancel:${subscriptionId}`;

    try {
      const result = await BillingAdminApi.cancelSubscription(subscriptionId, reason, keyFor(intent));
      settle(intent);
      toast.success(result.status === "CANCELLED" ? "Cancelled." : "Cancellation sent; it is being confirmed with Razorpay.");
      await load();
    } catch (error) {
      settle(intent, error);
      toast.error(errorMessage(error, "Could not cancel."));
      // The dialog keeps itself open, with the typed reason, on a failure.
      throw error;
    }
  }

  if (loading && !explanation) return <Skeleton className="h-96 w-full" />;
  if (!explanation || !timeline) return <p className="text-sm text-muted-foreground">Nothing to show.</p>;

  const { permissions } = explanation;
  const winner = explanation.winningSource;

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-medium">{explanation.user.name}</span>
          <span className="text-sm text-muted-foreground">{explanation.user.email}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Effective plan</span>
          <Badge>{PLAN_LABEL[explanation.plan] ?? explanation.plan}</Badge>
          <span className="text-muted-foreground">
            from{" "}
            {winner.kind === "DEFAULT"
              ? "the free default"
              : winner.kind === "SUBSCRIPTION"
                ? `subscription ${winner.subscriptionId}`
                : `grant ${winner.grantId}`}
            . Subscriptions are honored from {explanation.expectedMode}. As of {formatDate(explanation.at)}.
          </span>
        </div>
      </div>

      {explanation.openAnomalies.length > 0 && (
        <div className="rounded-md border border-destructive/40 p-3 text-sm">
          <div className="font-medium">Open anomalies</div>
          <ul className="mt-1 list-disc pl-5">
            {explanation.openAnomalies.map((anomaly) => (
              <li key={anomaly.id}>
                <Link href={anomalyHref(anomaly.id)} className="underline underline-offset-2">
                  {humanize(anomaly.type)}
                </Link>{" "}
                <span className="text-muted-foreground">since {formatDate(anomaly.firstSeenAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Why this access</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Effect</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {explanation.sources.map((source) => {
              if (source.kind === "DEFAULT") {
                return (
                  <TableRow key="default">
                    <TableCell>Free default</TableCell>
                    <TableCell>{PLAN_LABEL.FREE}</TableCell>
                    <TableCell>Contributing</TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                );
              }

              if (source.kind === "GRANT") {
                return (
                  <TableRow key={source.grantId}>
                    <TableCell>Grant ({humanize(source.source)})</TableCell>
                    <TableCell>{PLAN_LABEL[source.plan] ?? source.plan}</TableCell>
                    <TableCell>
                      <Badge variant={source.contributes ? "default" : "secondary"}>{contributionLabel(source)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(source.validFrom)} → {formatDate(source.validUntil, "no expiry")}
                      {source.grant && (
                        <div className="text-muted-foreground">
                          {source.grant.reason}
                          {source.grant.grantedBy ? ` — ${source.grant.grantedBy.name ?? source.grant.grantedBy.id}` : ""}
                          {source.grant.revokeReason ? ` · revoked: ${source.grant.revokeReason}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                );
              }

              const sub = source.subscription;
              const canCancel = permissions.canManageBilling && CANCELLABLE_PHASES.includes(source.phase);

              return (
                <TableRow key={source.subscriptionId}>
                  <TableCell>
                    Subscription {sub ? `(${humanize(sub.kind)}, ${humanize(sub.cycle)})` : ""}
                    <div className="font-mono text-xs text-muted-foreground">{source.subscriptionId}</div>
                  </TableCell>
                  <TableCell>{PLAN_LABEL[source.plan] ?? source.plan}</TableCell>
                  <TableCell>
                    <Badge variant={source.contributes ? "default" : "secondary"}>{contributionLabel(source)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {humanize(source.phase)}
                    {sub?.phaseSince ? ` since ${formatDate(sub.phaseSince)}` : ""}
                    {sub && (
                      <div className="text-muted-foreground">
                        Razorpay: {sub.providerStatus ?? "—"} · period ends {formatDate(sub.currentPeriodEnd)}
                        {sub.cancelAtPeriodEnd ? " · cancels at period end" : ""}
                        <br />
                        Last synced {formatDate(sub.lastSyncedAt, "never")}
                        {sub.syncDueAt ? ` · due ${formatDate(sub.syncDueAt)} (${humanize(sub.syncReason ?? "unknown")})` : ""}
                        {sub.syncAttempts > 0 ? ` · ${sub.syncAttempts} failed attempt(s)` : ""}
                        {sub.providerSubscriptionId && (
                          <>
                            <br />
                            <span className="font-mono text-xs">{sub.providerSubscriptionId}</span>
                          </>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="space-x-2 whitespace-nowrap text-right">
                    <Button size="sm" variant="outline" onClick={() => setFilter(filter === source.subscriptionId ? null : source.subscriptionId)}>
                      {filter === source.subscriptionId ? "All entries" : "Timeline"}
                    </Button>
                    {sub?.providerSubscriptionId && (
                      <Button size="sm" variant="outline" disabled={syncing === source.subscriptionId} onClick={() => void syncNow(source.subscriptionId)}>
                        {syncing === source.subscriptionId ? "Syncing…" : "Sync now"}
                      </Button>
                    )}
                    {canCancel && (
                      <Button size="sm" variant="destructive" onClick={() => setCancelTarget(source.subscriptionId)}>
                        Cancel now…
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Timeline{filter ? " (one subscription)" : ""}</h2>
        <BillingTimeline timeline={timeline} subscriptionFilter={filter} />
      </section>

      <ReasonDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel this subscription now?"
        description="This cancels it immediately at Razorpay; the customer keeps no remaining paid time. It cannot be undone, and any refund is made in the Razorpay Dashboard."
        confirmLabel="Cancel subscription"
        destructive
        onConfirm={(reason) => cancelNow(cancelTarget as string, reason)}
      />
    </div>
  );
}
