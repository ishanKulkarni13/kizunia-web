"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { BillingAdminApi } from "../../api/billing-admin-api";
import type { BillingTimelineDTO, RawPayloadDTO, TimelineEntryDTO } from "../../backend/admin/admin-billing.dto";
import { errorMessage, formatDate, formatMoney, humanize } from "./billing-admin-format";

const KIND_LABEL: Record<TimelineEntryDTO["kind"], string> = {
  HISTORY: "History",
  OPERATION: "Operation",
  EVENT: "Webhook",
  MONEY_FACT: "Money",
};

function Summary({ entry }: { entry: TimelineEntryDTO }) {
  switch (entry.kind) {
    case "HISTORY":
      return (
        <>
          <span className="font-medium">
            {humanize(entry.change)}: {entry.fromValue ?? "—"} → {entry.toValue ?? "—"}
          </span>
          <span className="text-muted-foreground">
            {" "}
            · {humanize(entry.cause)} · {humanize(entry.trigger)}
          </span>
        </>
      );

    case "OPERATION": {
      const note = entry.request.note ?? entry.request.reason;

      return (
        <>
          <span className="font-medium">
            {humanize(entry.operationKind)} — {humanize(entry.status)}
          </span>
          <span className="text-muted-foreground">
            {" "}
            · {humanize(entry.actorKind)}
            {note ? ` · ${String(note)}` : ""}
            {entry.failureClass ? ` · ${humanize(entry.failureClass)}` : ""}
          </span>
        </>
      );
    }

    case "EVENT":
      return (
        <>
          <span className="font-medium">{entry.eventType}</span>
          <span className="text-muted-foreground">
            {" "}
            · {humanize(entry.status)} · {entry.matchedSecret.toLowerCase()} secret
            {entry.duplicateCount > 0 ? ` · ${entry.duplicateCount} duplicate(s)` : ""}
          </span>
          <div className="font-mono text-xs text-muted-foreground">{entry.providerEventId}</div>
        </>
      );

    case "MONEY_FACT":
      return (
        <>
          <span className="font-medium">
            {humanize(entry.factKind)} {formatMoney(entry.amountMinor, entry.currency)}
          </span>
          <div className="font-mono text-xs text-muted-foreground">{entry.providerObjectId}</div>
        </>
      );
  }
}

/**
 * The merged billing timeline, newest first. The raw provider payload is never
 * part of it: an event says only whether its payload is retained, and a
 * SUPER_ADMIN (as the server reports) can open it on demand from a separate,
 * logged endpoint.
 */
export function BillingTimeline({
  timeline,
  subscriptionFilter,
}: {
  timeline: BillingTimelineDTO;
  /** Show only this subscription's entries; `null` shows everything. */
  subscriptionFilter: string | null;
}) {
  const [payload, setPayload] = useState<RawPayloadDTO | null>(null);
  const [loadingPayload, setLoadingPayload] = useState<string | null>(null);

  const entries = subscriptionFilter ? timeline.entries.filter((entry) => entry.subscriptionId === subscriptionFilter) : timeline.entries;

  async function openPayload(eventId: string) {
    setLoadingPayload(eventId);

    try {
      setPayload(await BillingAdminApi.rawPayload(eventId));
    } catch (error) {
      toast.error(errorMessage(error, "Could not load the payload."));
    } finally {
      setLoadingPayload(null);
    }
  }

  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;

  return (
    <div className="space-y-2">
      {timeline.truncated && (
        <p className="text-xs text-muted-foreground">Showing the newest entries of each kind; older ones are not listed.</p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>What</TableHead>
            <TableHead className="text-right">Payload</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={`${entry.kind}-${entry.id}`}>
              <TableCell className="whitespace-nowrap align-top">{formatDate(entry.at)}</TableCell>
              <TableCell className="align-top">
                <Badge variant="outline">{KIND_LABEL[entry.kind]}</Badge>
              </TableCell>
              <TableCell className="align-top">
                <Summary entry={entry} />
              </TableCell>
              <TableCell className="text-right align-top">
                {entry.kind === "EVENT" &&
                  (entry.hasPayload ? (
                    timeline.permissions.canViewRawPayloads ? (
                      <Button size="sm" variant="outline" disabled={loadingPayload === entry.id} onClick={() => void openPayload(entry.id)}>
                        View
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Restricted</span>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">Pruned {formatDate(entry.payloadPrunedAt, "")}</span>
                  ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={payload !== null} onOpenChange={(open) => !open && setPayload(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Raw webhook payload</DialogTitle>
            <DialogDescription>
              May contain customer contact details. Viewing is recorded with your name. Do not copy it into tickets or chat.
            </DialogDescription>
          </DialogHeader>
          {payload?.pruned ? (
            <p className="text-sm text-muted-foreground">This payload was pruned {formatDate(payload.prunedAt, "")}.</p>
          ) : (
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(payload?.payload ?? null, null, 2)}</pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
