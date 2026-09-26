"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { BillingAdminApi } from "../../api/billing-admin-api";
import type { AnomalyDetailDTO } from "../../backend/admin/admin-billing.dto";
import { errorMessage, formatDate, humanize, userHref } from "./billing-admin-format";
import { ReasonDialog } from "./reason-dialog";

/**
 * One anomaly, and (SUPER_ADMIN, as the server reports) its resolution.
 *
 * Resolving records a human decision with a reason. It never changes billing
 * state: fix the underlying situation first (immediate cancel, sync now, a
 * configuration change), then resolve. If it is still true, it is detected
 * again and opens a new anomaly.
 */
export function AnomalyDetail({ anomalyId }: { anomalyId: string }) {
  const [anomaly, setAnomaly] = useState<AnomalyDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolveOpen, setResolveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      setAnomaly(await BillingAdminApi.getAnomaly(anomalyId));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load the anomaly."));
    } finally {
      setLoading(false);
    }
  }, [anomalyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(reason: string) {
    try {
      setAnomaly(await BillingAdminApi.resolveAnomaly(anomalyId, reason));
      toast.success("Anomaly resolved.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not resolve the anomaly."));
      // The dialog keeps itself open, with the typed reason, on a failure.
      throw error;
    }
  }

  if (loading && !anomaly) return <Skeleton className="h-64 w-full" />;
  if (!anomaly) return <p className="text-sm text-muted-foreground">Anomaly not found.</p>;

  const open = anomaly.resolvedAt === null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-medium">{humanize(anomaly.type)}</span>
        <Badge variant={open ? "destructive" : "secondary"}>{open ? "Open" : "Resolved"}</Badge>
        <Badge variant="outline">{anomaly.providerMode}</Badge>
        {open && anomaly.permissions.canManageBilling && (
          <Button className="ml-auto" onClick={() => setResolveOpen(true)}>
            Resolve…
          </Button>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-[12rem_1fr]">
        <dt className="text-muted-foreground">First seen</dt>
        <dd>{formatDate(anomaly.firstSeenAt)}</dd>
        <dt className="text-muted-foreground">Last seen</dt>
        <dd>
          {formatDate(anomaly.lastSeenAt)} ({anomaly.occurrences}×)
        </dd>
        <dt className="text-muted-foreground">Subject</dt>
        <dd className="font-mono text-xs">{anomaly.subjectKey}</dd>
        {anomaly.userId && (
          <>
            <dt className="text-muted-foreground">User</dt>
            <dd>
              <Link href={userHref(anomaly.userId)} className="underline underline-offset-2">
                Open this user&apos;s billing view
              </Link>
            </dd>
          </>
        )}
        {anomaly.subscriptionIds.length > 0 && (
          <>
            <dt className="text-muted-foreground">Subscriptions</dt>
            <dd className="font-mono text-xs">{anomaly.subscriptionIds.join(", ")}</dd>
          </>
        )}
        {anomaly.providerSubscriptionId && (
          <>
            <dt className="text-muted-foreground">Razorpay subscription</dt>
            <dd className="font-mono text-xs">{anomaly.providerSubscriptionId}</dd>
          </>
        )}
        {anomaly.resolvedAt && (
          <>
            <dt className="text-muted-foreground">Resolved</dt>
            <dd>
              {formatDate(anomaly.resolvedAt)} by {anomaly.resolvedBy?.name ?? anomaly.resolvedBy?.id ?? "the system"}
              {anomaly.resolutionReason ? ` — ${anomaly.resolutionReason}` : ""}
            </dd>
          </>
        )}
      </dl>

      <div className="space-y-1">
        <h2 className="text-sm font-medium">What was detected</h2>
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(anomaly.details, null, 2)}</pre>
      </div>

      <ReasonDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        title="Resolve this anomaly?"
        description="Records that you handled it, with your name and reason. It changes no billing state: if the situation is still true, it will be detected again as a new anomaly."
        confirmLabel="Resolve"
        onConfirm={resolve}
      />
    </div>
  );
}
